import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { createPkcePair, createState } from "./pkce.js";
import {
  authEnv,
  buildAuthorizeUrl,
  exchangeAuthorizationCode,
  invalidateTokens,
} from "./auth.js";
import { getCredentials, activeProfile, persistEnv } from "./config.js";
import { resolveHost } from "./host.js";
import { logger } from "./logging.js";
import { ServiceNowError } from "./errors.js";

/**
 * OAuth 2.1 Authorization Code + PKCE login (RFC 8252 native-app flow). Run once
 * via `servicenow-mcp-ai login`: opens the browser to the ServiceNow
 * authorization page, captures the redirect on a loopback listener, exchanges
 * the code (with the PKCE verifier) for tokens, and stores the refresh token so
 * the server runs non-interactively afterwards (refresh_token grant). This
 * replaces the deprecated OAuth 2.0 password grant (ROPC).
 */

const DEFAULT_REDIRECT_URI = "http://localhost:53682/callback";

export interface RedirectResult {
  code?: string;
  error?: string;
}

/**
 * Parse the OAuth redirect request (`req.url`) and validate the CSRF `state`.
 * Pure, so the success/error decision is unit-tested without a browser.
 */
export function parseRedirect(
  requestUrl: string,
  expectedState: string,
): RedirectResult {
  let url: URL;
  try {
    url = new URL(requestUrl, "http://localhost");
  } catch {
    return { error: "malformed redirect request" };
  }
  const p = url.searchParams;
  const err = p.get("error");
  if (err) return { error: p.get("error_description") || err };
  if (p.get("state") !== expectedState) {
    return { error: "state mismatch (possible CSRF) — ignoring the redirect" };
  }
  const code = p.get("code");
  if (!code) return { error: "no authorization code in the redirect" };
  return { code };
}

function escapeHtml(s: string): string {
  return s.replace(
    /[&<>"]/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c] ?? c,
  );
}

function openBrowser(url: string): void {
  const platform = process.platform;
  const cmd =
    platform === "darwin" ? "open" : platform === "win32" ? "cmd" : "xdg-open";
  const args = platform === "win32" ? ["/c", "start", "", url] : [url];
  try {
    const child = spawn(cmd, args, { stdio: "ignore", detached: true });
    child.on("error", () => {
      /* best-effort — the URL is also printed */
    });
    child.unref();
  } catch {
    /* ignore — the URL is printed for manual opening */
  }
}

export interface LoginOptions {
  /** Open the system browser automatically (default true). */
  open?: boolean;
  /** Milliseconds to wait for the redirect before giving up (default 5 min). */
  timeoutMs?: number;
  /** Called with the authorization URL once the listener is up (for tests/UX). */
  onAuthUrl?: (url: string) => void;
}

export interface LoginResult {
  host: string;
  profile: string;
}

/** Run the interactive Authorization Code + PKCE login for the active profile. */
export async function runOAuthLogin(
  opts: LoginOptions = {},
): Promise<LoginResult> {
  const profile = activeProfile();
  const { instance } = getCredentials();
  if (!instance) {
    throw new ServiceNowError(
      "Set SN_INSTANCE (or the active profile's instance) before running login.",
    );
  }
  const host = resolveHost(instance);
  const clientId = authEnv("OAUTH_CLIENT_ID")?.trim();
  if (!clientId) {
    throw new ServiceNowError(
      "OAuth login needs SN_OAUTH_CLIENT_ID — register an Authorization Code OAuth API endpoint in ServiceNow first.",
    );
  }
  const clientSecret = authEnv("OAUTH_CLIENT_SECRET")?.trim() || undefined;
  const scope = authEnv("OAUTH_SCOPE")?.trim() || undefined;
  const redirectUri =
    authEnv("OAUTH_REDIRECT_URI")?.trim() || DEFAULT_REDIRECT_URI;

  const redirect = new URL(redirectUri);
  if (redirect.hostname !== "localhost" && redirect.hostname !== "127.0.0.1") {
    throw new ServiceNowError(
      `SN_OAUTH_REDIRECT_URI must be a loopback URL (localhost / 127.0.0.1); got "${redirectUri}".`,
    );
  }
  const port = Number(redirect.port || "80");

  const pkce = createPkcePair();
  const state = createState();
  const authUrl = buildAuthorizeUrl(host, {
    clientId,
    redirectUri,
    codeChallenge: pkce.challenge,
    state,
    scope,
  });

  const code = await new Promise<string>((resolve, reject) => {
    const server = createServer((req, res) => {
      const result = parseRedirect(req.url ?? "/", state);
      const ok = !result.error;
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(
        `<!doctype html><meta charset="utf-8"><body style="font-family:system-ui;padding:3rem;max-width:32rem">` +
          `<h2>${ok ? "✓ Authorized" : "✗ Login failed"}</h2>` +
          `<p>${ok ? "You can close this tab and return to the terminal." : escapeHtml(result.error ?? "")}</p></body>`,
      );
      clearTimeout(timer);
      server.close();
      if (ok && result.code) resolve(result.code);
      else reject(new ServiceNowError(`OAuth login failed: ${result.error}`));
    });
    const timer = setTimeout(() => {
      server.close();
      reject(
        new ServiceNowError(
          "OAuth login timed out waiting for the browser redirect.",
        ),
      );
    }, opts.timeoutMs ?? 300_000);
    server.on("error", (e) => {
      clearTimeout(timer);
      reject(
        new ServiceNowError(
          `Could not start the loopback listener on ${redirectUri}: ${e.message}`,
        ),
      );
    });
    server.listen(port, redirect.hostname, () => {
      process.stderr.write(
        `\nAuthorize servicenow-mcp-ai by opening this URL:\n\n  ${authUrl}\n\n`,
      );
      opts.onAuthUrl?.(authUrl);
      if (opts.open !== false) openBrowser(authUrl);
    });
  });

  const tokens = await exchangeAuthorizationCode(host, {
    clientId,
    clientSecret,
    code,
    codeVerifier: pkce.verifier,
    redirectUri,
  });
  if (!tokens.refreshToken) {
    throw new ServiceNowError(
      "The token response had no refresh_token — enable a refresh-token lifespan on the OAuth entity so the server can run non-interactively.",
    );
  }

  const prefix =
    profile === "default" ? "SN_" : `SN_PROFILE_${profile.toUpperCase()}_`;
  persistEnv({
    [`${prefix}AUTH`]: "oauth",
    [`${prefix}OAUTH_GRANT`]: "refresh_token",
    [`${prefix}OAUTH_REFRESH_TOKEN`]: tokens.refreshToken,
  });
  invalidateTokens();
  logger.info("OAuth login complete — refresh token stored", { host, profile });
  return { host, profile };
}
