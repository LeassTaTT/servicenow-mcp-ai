import { readFileSync } from "node:fs";
import { ServiceNowError } from "./errors.js";
import { getCredentials, activeProfile } from "./config.js";
import { getTimeoutMs } from "./settings.js";
import { logger } from "./logging.js";
import { signJwtRS256 } from "./jwt.js";

/**
 * Read an auth env var with the active profile's override winning over the
 * global key: SN_PROFILE_<NAME>_<SUFFIX> first, then SN_<SUFFIX>. Mirrors
 * core/policy.ts so per-profile auth follows the same precedence as per-profile
 * policy — the MI-1 convention lets a profile set its own _AUTH / _OAUTH_*
 * (e.g. "prod is OAuth, dev is Basic" in one server). An empty override is
 * treated as unset and falls through to the global key.
 */
export function authEnv(suffix: string): string | undefined {
  const profile = activeProfile();
  if (profile !== "default") {
    const scoped = process.env[`SN_PROFILE_${profile.toUpperCase()}_${suffix}`];
    if (scoped !== undefined && scoped.trim() !== "") return scoped;
  }
  return process.env[`SN_${suffix}`];
}

/** Every inbound REST auth method ServiceNow supports. */
export type AuthMode = "basic" | "oauth" | "apikey" | "token" | "none";

/**
 * Pluggable authentication for the ServiceNow client.
 *
 * `headers(host)` returns the HTTP headers to merge into the request — an
 * `Authorization` value for Basic/OAuth/Bearer, an `x-sn-apikey` for API keys,
 * or nothing for `none` (certificate-only mutual TLS). The host is already
 * resolved and SSRF-checked by the caller, so an OAuth provider can safely
 * derive the token endpoint from it.
 */
export interface AuthProvider {
  readonly mode: AuthMode;
  headers(host: string): Promise<Record<string, string>>;
}

function basicHeader(user: string, password: string): string {
  return `Basic ${Buffer.from(`${user}:${password}`).toString("base64")}`;
}

class BasicAuthProvider implements AuthProvider {
  readonly mode = "basic" as const;

  headers(): Promise<Record<string, string>> {
    const { user, password } = getCredentials();
    if (!user || !password) {
      throw new ServiceNowError(
        "ServiceNow Basic auth requires SN_USER and SN_PASSWORD. Use the servicenow_set_credentials tool first.",
      );
    }
    return Promise.resolve({ Authorization: basicHeader(user, password) });
  }
}

/** API Key auth: ServiceNow Inbound API Keys, sent as the `x-sn-apikey` header. */
class ApiKeyAuthProvider implements AuthProvider {
  readonly mode = "apikey" as const;

  headers(): Promise<Record<string, string>> {
    const key = authEnv("API_KEY")?.trim();
    if (!key) {
      throw new ServiceNowError("API key auth requires SN_API_KEY.");
    }
    return Promise.resolve({ "x-sn-apikey": key });
  }
}

/** A caller-supplied bearer token used verbatim (no token exchange). */
class BearerAuthProvider implements AuthProvider {
  readonly mode = "token" as const;

  headers(): Promise<Record<string, string>> {
    const token = authEnv("BEARER_TOKEN")?.trim();
    if (!token) {
      throw new ServiceNowError("Token auth requires SN_BEARER_TOKEN.");
    }
    return Promise.resolve({ Authorization: `Bearer ${token}` });
  }
}

/** No auth header — for certificate-only mutual TLS (the cert maps to a user). */
class NoneAuthProvider implements AuthProvider {
  readonly mode = "none" as const;
  headers(): Promise<Record<string, string>> {
    return Promise.resolve({});
  }
}

type OAuthGrant =
  | "password"
  | "client_credentials"
  | "refresh_token"
  | "jwt_bearer";

interface OAuthConfig {
  clientId: string;
  clientSecret?: string;
  grantType: OAuthGrant;
  username?: string;
  password?: string;
  refreshToken?: string;
}

function readOAuthConfig(): OAuthConfig {
  const clientId = authEnv("OAUTH_CLIENT_ID")?.trim() ?? "";
  if (!clientId) {
    throw new ServiceNowError(
      "OAuth auth requires SN_OAUTH_CLIENT_ID (and usually SN_OAUTH_CLIENT_SECRET).",
    );
  }
  const rawGrant = authEnv("OAUTH_GRANT")?.trim().toLowerCase() || "password";
  if (
    rawGrant !== "password" &&
    rawGrant !== "client_credentials" &&
    rawGrant !== "refresh_token" &&
    rawGrant !== "jwt_bearer"
  ) {
    throw new ServiceNowError(
      `Unsupported SN_OAUTH_GRANT "${rawGrant}". Use password, client_credentials, refresh_token or jwt_bearer.`,
    );
  }
  const grantType: OAuthGrant = rawGrant;

  const { user, password } = getCredentials();
  const cfg: OAuthConfig = {
    clientId,
    clientSecret: authEnv("OAUTH_CLIENT_SECRET")?.trim() || undefined,
    grantType,
  };

  if (grantType === "password") {
    if (!user || !password) {
      throw new ServiceNowError(
        "OAuth password grant requires SN_USER and SN_PASSWORD.",
      );
    }
    cfg.username = user;
    cfg.password = password;
  } else if (grantType === "refresh_token") {
    const refreshToken = authEnv("OAUTH_REFRESH_TOKEN")?.trim();
    if (!refreshToken) {
      throw new ServiceNowError(
        "OAuth refresh_token grant requires SN_OAUTH_REFRESH_TOKEN.",
      );
    }
    cfg.refreshToken = refreshToken;
  } else if (grantType === "jwt_bearer") {
    // The subject identifies the cached token; the signed assertion is built per
    // refresh in getToken().
    cfg.username = jwtSubject();
  }

  return cfg;
}

/** The subject (impersonated user) for the JWT-bearer grant. */
function jwtSubject(): string {
  return authEnv("OAUTH_JWT_SUB")?.trim() || getCredentials().user;
}

/**
 * Build the signed JWT assertion for the OAuth 2.0 JWT-bearer grant. The private
 * key comes from SN_OAUTH_JWT_KEY (PEM) or SN_OAUTH_JWT_KEY_FILE; its public
 * certificate is registered on the ServiceNow JWT provider.
 */
function buildJwtAssertion(host: string, clientId: string): string {
  const inlineKey = authEnv("OAUTH_JWT_KEY");
  const keyFile = authEnv("OAUTH_JWT_KEY_FILE")?.trim();
  const keyPem = (
    inlineKey ?? (keyFile ? readFileSync(keyFile, "utf8") : "")
  ).trim();
  if (!keyPem) {
    throw new ServiceNowError(
      "OAuth jwt_bearer grant requires SN_OAUTH_JWT_KEY or SN_OAUTH_JWT_KEY_FILE (a PEM private key).",
    );
  }
  const sub = jwtSubject();
  if (!sub) {
    throw new ServiceNowError(
      "OAuth jwt_bearer grant requires SN_OAUTH_JWT_SUB or SN_USER (the subject).",
    );
  }
  const iss = authEnv("OAUTH_JWT_ISS")?.trim() || clientId;
  const aud =
    authEnv("OAUTH_JWT_AUD")?.trim() || `https://${host}/oauth_token.do`;
  const kid = authEnv("OAUTH_JWT_KID")?.trim() || undefined;
  const expRaw = Number(authEnv("OAUTH_JWT_EXP_SEC"));
  const expSec =
    Number.isFinite(expRaw) && expRaw > 0 ? Math.floor(expRaw) : 300;
  const now = Math.floor(Date.now() / 1000);
  return signJwtRS256(
    { iss, sub, aud, iat: now, exp: now + expSec },
    keyPem,
    kid,
  );
}

interface CachedToken {
  token: string;
  expiresAt: number;
}

// Cached per host + client + grant + user. The password/secret is NOT part of
// the key, so a credential change must clear the cache explicitly (see
// invalidateTokens) or a token obtained with the old secrets would live on.
const tokenCache = new Map<string, CachedToken>();

/** Drop all cached OAuth tokens. Call whenever credentials change. */
export function invalidateTokens(): void {
  tokenCache.clear();
}

/**
 * Drop the cached tokens for one host — used by the 401 retry in http.ts when
 * a token is revoked server-side before its TTL runs out.
 */
export function invalidateToken(host: string): void {
  for (const key of tokenCache.keys()) {
    if (key.startsWith(`${host}|`)) tokenCache.delete(key);
  }
}

/**
 * POST to the ServiceNow token endpoint and return the parsed JSON, mapping a
 * non-2xx response or a transport error to a ServiceNowError. Shared by the
 * runtime grants and the Authorization Code + PKCE exchange.
 */
async function requestToken(
  host: string,
  body: URLSearchParams,
): Promise<Record<string, unknown>> {
  const url = `https://${host}/oauth_token.do`;
  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
      },
      body: body.toString(),
      signal: AbortSignal.timeout(getTimeoutMs()),
    });
  } catch (cause) {
    const err = cause instanceof Error ? cause : new Error(String(cause));
    throw new ServiceNowError(
      `OAuth token request to ${host} failed: ${err.message}`,
    );
  }

  const text = await res.text();
  let json: Record<string, unknown> = {};
  if (text) {
    try {
      json = JSON.parse(text) as Record<string, unknown>;
    } catch {
      json = {};
    }
  }

  if (!res.ok) {
    const detail =
      (typeof json.error_description === "string" && json.error_description) ||
      (typeof json.error === "string" && json.error) ||
      res.statusText ||
      "(no detail)";
    throw new ServiceNowError(
      `OAuth token request failed (${res.status}): ${detail}`,
      res.status,
      json,
    );
  }
  return json;
}

export interface AuthorizeUrlParams {
  clientId: string;
  redirectUri: string;
  codeChallenge: string;
  state: string;
  scope?: string;
}

/**
 * Build the OAuth 2.1 Authorization Code + PKCE authorization URL for the
 * ServiceNow authorization endpoint (`/oauth_auth.do`).
 */
export function buildAuthorizeUrl(host: string, p: AuthorizeUrlParams): string {
  const q = new URLSearchParams({
    response_type: "code",
    client_id: p.clientId,
    redirect_uri: p.redirectUri,
    state: p.state,
    code_challenge: p.codeChallenge,
    code_challenge_method: "S256",
  });
  if (p.scope) q.set("scope", p.scope);
  return `https://${host}/oauth_auth.do?${q.toString()}`;
}

export interface TokenSet {
  accessToken: string;
  refreshToken?: string;
  expiresIn?: number;
}

/**
 * Exchange an authorization code (with its PKCE verifier) for tokens — the
 * second leg of the OAuth 2.1 Authorization Code + PKCE flow. Returns the
 * refresh token used for subsequent non-interactive runs.
 */
export async function exchangeAuthorizationCode(
  host: string,
  p: {
    clientId: string;
    clientSecret?: string;
    code: string;
    codeVerifier: string;
    redirectUri: string;
  },
): Promise<TokenSet> {
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    client_id: p.clientId,
    code: p.code,
    code_verifier: p.codeVerifier,
    redirect_uri: p.redirectUri,
  });
  if (p.clientSecret) body.set("client_secret", p.clientSecret);
  const json = await requestToken(host, body);
  const accessToken = json.access_token;
  if (typeof accessToken !== "string" || !accessToken) {
    throw new ServiceNowError(
      "Authorization Code exchange did not return an access_token.",
    );
  }
  const ttl = Number(json.expires_in);
  return {
    accessToken,
    refreshToken:
      typeof json.refresh_token === "string" ? json.refresh_token : undefined,
    expiresIn: Number.isFinite(ttl) ? ttl : undefined,
  };
}

/** Skew applied before expiry so a token is refreshed slightly early. */
const TOKEN_SKEW_MS = 30_000;
const DEFAULT_TOKEN_TTL_SEC = 1800;

class OAuthProvider implements AuthProvider {
  readonly mode = "oauth" as const;

  async headers(host: string): Promise<Record<string, string>> {
    return { Authorization: `Bearer ${await this.getToken(host)}` };
  }

  private async getToken(host: string): Promise<string> {
    const cfg = readOAuthConfig();
    const key = `${host}|${cfg.clientId}|${cfg.grantType}|${cfg.username ?? ""}`;
    const cached = tokenCache.get(key);
    if (cached && cached.expiresAt > Date.now() + TOKEN_SKEW_MS) {
      return cached.token;
    }

    const body = new URLSearchParams();
    body.set("client_id", cfg.clientId);
    if (cfg.clientSecret) body.set("client_secret", cfg.clientSecret);
    if (cfg.grantType === "jwt_bearer") {
      body.set("grant_type", "urn:ietf:params:oauth:grant-type:jwt-bearer");
      body.set("assertion", buildJwtAssertion(host, cfg.clientId));
    } else {
      body.set("grant_type", cfg.grantType);
      if (cfg.grantType === "password") {
        body.set("username", cfg.username!);
        body.set("password", cfg.password!);
      } else if (cfg.grantType === "refresh_token") {
        body.set("refresh_token", cfg.refreshToken!);
      }
    }

    const json = await requestToken(host, body);

    const token = json.access_token;
    if (typeof token !== "string" || !token) {
      throw new ServiceNowError(
        "OAuth token response did not contain an access_token.",
      );
    }
    const ttlSec = Number(json.expires_in);
    const expiresAt =
      Date.now() +
      (Number.isFinite(ttlSec) && ttlSec > 0 ? ttlSec : DEFAULT_TOKEN_TTL_SEC) *
        1000;
    tokenCache.set(key, { token, expiresAt });
    logger.debug("Obtained OAuth access token", {
      host,
      grant: cfg.grantType,
      expiresInSec: Number.isFinite(ttlSec) ? ttlSec : undefined,
    });
    return token;
  }
}

/**
 * Resolve the configured auth mode. An explicit SN_AUTH wins; otherwise it is
 * inferred from the present keys: API key → bearer token → OAuth client id →
 * Basic. Use SN_AUTH=none for certificate-only mutual TLS.
 */
export function getAuthMode(): AuthMode {
  const explicit = authEnv("AUTH")?.trim().toLowerCase();
  if (
    explicit === "basic" ||
    explicit === "oauth" ||
    explicit === "apikey" ||
    explicit === "token" ||
    explicit === "none"
  ) {
    return explicit;
  }
  if (authEnv("API_KEY")?.trim()) return "apikey";
  if (authEnv("BEARER_TOKEN")?.trim()) return "token";
  if (authEnv("OAUTH_CLIENT_ID")?.trim()) return "oauth";
  return "basic";
}

const basicProvider = new BasicAuthProvider();
const oauthProvider = new OAuthProvider();
const apiKeyProvider = new ApiKeyAuthProvider();
const bearerProvider = new BearerAuthProvider();
const noneProvider = new NoneAuthProvider();

/** Return the auth provider for the current configuration. */
export function getAuthProvider(): AuthProvider {
  switch (getAuthMode()) {
    case "oauth":
      return oauthProvider;
    case "apikey":
      return apiKeyProvider;
    case "token":
      return bearerProvider;
    case "none":
      return noneProvider;
    default:
      return basicProvider;
  }
}
