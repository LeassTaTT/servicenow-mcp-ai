import { readFileSync } from "node:fs";
import { ServiceNowError } from "./errors.js";

/**
 * Mutual-TLS (client-certificate) support. When SN_TLS_CLIENT_CERT/_KEY are set
 * the client presents a certificate on the TLS handshake — ServiceNow maps it to
 * a user (a mutual-auth profile). This can stand alone (SN_AUTH=none) or layer
 * under any header-based method. The undici dispatcher is loaded dynamically so
 * undici stays an OPTIONAL dependency — only mTLS users install it.
 */

let cached: { key: string; dispatcher: unknown } | null = null;

function readPem(inline?: string, file?: string): string | undefined {
  if (inline && inline.trim()) return inline;
  if (file && file.trim()) return readFileSync(file.trim(), "utf8");
  return undefined;
}

/**
 * The undici dispatcher carrying the client certificate, or undefined when mTLS
 * is not configured. Throws a clear error if undici is not installed.
 */
export async function getTlsDispatcher(): Promise<unknown> {
  const cert = readPem(
    process.env.SN_TLS_CLIENT_CERT,
    process.env.SN_TLS_CLIENT_CERT_FILE,
  );
  const key = readPem(
    process.env.SN_TLS_CLIENT_KEY,
    process.env.SN_TLS_CLIENT_KEY_FILE,
  );
  if (!cert || !key) return undefined;
  const ca = readPem(process.env.SN_TLS_CA, process.env.SN_TLS_CA_FILE);
  const rejectUnauthorized =
    process.env.SN_TLS_REJECT_UNAUTHORIZED?.trim().toLowerCase() !== "false";

  const cacheKey = `${cert.length}|${key.length}|${ca?.length ?? 0}|${rejectUnauthorized}`;
  if (cached && cached.key === cacheKey) return cached.dispatcher;

  // Non-literal specifier so the type-checker keeps undici optional.
  const moduleName = "undici";
  let undici: { Agent: new (opts: unknown) => unknown };
  try {
    undici = (await import(moduleName)) as {
      Agent: new (opts: unknown) => unknown;
    };
  } catch {
    throw new ServiceNowError(
      "Mutual TLS (SN_TLS_CLIENT_CERT/_KEY) needs the optional 'undici' package — install it with: npm install undici",
    );
  }
  const dispatcher = new undici.Agent({
    connect: { cert, key, ca, rejectUnauthorized },
  });
  cached = { key: cacheKey, dispatcher };
  return dispatcher;
}

/** Test hook. */
export function _resetTlsDispatcher(): void {
  cached = null;
}
