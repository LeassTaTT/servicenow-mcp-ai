import { ServiceNowError } from "./errors.js";
import { getCredentials } from "./config.js";
import { resolveHost } from "./host.js";
import { getAuthProvider, getAuthMode, invalidateToken } from "./auth.js";
import { getTlsDispatcher } from "./mtls.js";
import { logger } from "./logging.js";
import { getMaxConcurrent, getMaxRetries, getTimeoutMs } from "./settings.js";

/**
 * In-process telemetry: enough to answer "why is it slow / what is failing"
 * from the client itself (exposed via get_status and servicenow://status).
 * Counted per host so the multi-instance work (Phase 7) gets a usable
 * breakdown for free; getTelemetry() also returns the aggregate.
 */
export interface Telemetry {
  requests: number;
  retries: number;
  errors: Record<string, number>;
  totalMs: number;
}

export interface TelemetrySnapshot extends Telemetry {
  perHost: Record<string, Telemetry>;
}

const perHostTelemetry = new Map<string, Telemetry>();

function telemetryFor(host: string): Telemetry {
  let t = perHostTelemetry.get(host);
  if (!t) {
    t = { requests: 0, retries: 0, errors: {}, totalMs: 0 };
    perHostTelemetry.set(host, t);
  }
  return t;
}

export function getTelemetry(): TelemetrySnapshot {
  const aggregate: TelemetrySnapshot = {
    requests: 0,
    retries: 0,
    errors: {},
    totalMs: 0,
    perHost: {},
  };
  for (const [host, t] of perHostTelemetry) {
    aggregate.requests += t.requests;
    aggregate.retries += t.retries;
    aggregate.totalMs += t.totalMs;
    for (const [k, n] of Object.entries(t.errors)) {
      aggregate.errors[k] = (aggregate.errors[k] ?? 0) + n;
    }
    aggregate.perHost[host] = { ...t, errors: { ...t.errors } };
  }
  return aggregate;
}

/** Test hook. */
export function _resetTelemetry(): void {
  perHostTelemetry.clear();
}

function countError(t: Telemetry, key: string | number | undefined): void {
  const k = String(key ?? "transport");
  t.errors[k] = (t.errors[k] ?? 0) + 1;
}

// Plain counting semaphore around fetch, per host: protects each instance
// from request salvos (tableLogic fires 5 in parallel, fetchAll can chain
// dozens) without one instance starving another (Phase 7).
interface Slot {
  active: number;
  waiters: (() => void)[];
}

const slots = new Map<string, Slot>();

async function withSlot<T>(host: string, fn: () => Promise<T>): Promise<T> {
  const limit = getMaxConcurrent();
  let slot = slots.get(host);
  if (!slot) {
    slot = { active: 0, waiters: [] };
    slots.set(host, slot);
  }
  const s = slot;
  while (s.active >= limit) {
    await new Promise<void>((resolve) => s.waiters.push(resolve));
  }
  s.active += 1;
  try {
    return await fn();
  } finally {
    s.active -= 1;
    s.waiters.shift()?.();
  }
}

/** Arguments for a single ServiceNow REST request. */
export interface SnRequestArgs {
  method: "GET" | "POST" | "PATCH" | "PUT" | "DELETE";
  /** Absolute API path under the instance origin, e.g. "/api/now/table/incident". */
  path: string;
  params?: URLSearchParams;
  /** JSON request body. Mutually exclusive with `rawBody`. */
  body?: unknown;
  /** Pre-encoded request body (e.g. binary upload). Sets `contentType`. */
  rawBody?: string | Uint8Array;
  /** Content-Type for `rawBody`. Ignored when `body` is used (always JSON). */
  contentType?: string;
  /** Accept header; defaults to application/json. */
  accept?: string;
  /** "json" (default) parses the body; "binary" returns base64 in `data`. */
  responseType?: "json" | "binary";
}

export interface SnResponse<T> {
  data: T;
  /** X-Total-Count (all matching rows) when the API provides it. */
  total?: number;
  status: number;
  /** Content-Type of the response, useful for binary downloads. */
  contentType?: string;
}

const RETRYABLE_ANY_METHOD = new Set([429, 503]);
const RETRYABLE_IDEMPOTENT = new Set([502, 504]);

function isIdempotent(method: string): boolean {
  return method === "GET";
}

function shouldRetryStatus(status: number, method: string): boolean {
  if (RETRYABLE_ANY_METHOD.has(status)) return true;
  return isIdempotent(method) && RETRYABLE_IDEMPOTENT.has(status);
}

function backoffMs(attempt: number): number {
  const base = Math.min(500 * 2 ** (attempt - 1), 8000);
  return base + Math.floor(Math.random() * 250);
}

function retryAfterMs(res: Response): number | undefined {
  const header = res.headers.get("retry-after");
  if (!header) return undefined;
  const seconds = Number(header);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  const date = Date.parse(header);
  return Number.isNaN(date) ? undefined : Math.max(0, date - Date.now());
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Parse the X-Total-Count header (total matching rows) when present. */
function parseTotalCount(res: Response): number | undefined {
  const raw = res.headers.get("x-total-count");
  return raw && /^\d+$/.test(raw) ? Number(raw) : undefined;
}

/** Extract a human-readable message from a ServiceNow error body. */
function extractErrorDetail(json: unknown): string | undefined {
  if (json && typeof json === "object" && "error" in json) {
    const err = (json as { error?: unknown }).error;
    if (err && typeof err === "object") {
      const o = err as { message?: unknown; detail?: unknown };
      if (typeof o.message === "string" && o.message) return o.message;
      if (typeof o.detail === "string" && o.detail) return o.detail;
    }
  }
  return undefined;
}

/**
 * Perform an authenticated request against the configured ServiceNow instance.
 *
 * The host is resolved and SSRF-checked before any network call, and the query
 * string is omitted from error messages (encoded queries can contain personal
 * data). Transient failures are retried with exponential backoff; non-idempotent
 * methods are retried only on connection errors, never on a received response.
 */
export async function snRequest<T>({
  method,
  path,
  params,
  body,
  rawBody,
  contentType,
  accept,
  responseType = "json",
}: SnRequestArgs): Promise<SnResponse<T>> {
  const { instance } = getCredentials();
  if (!instance) {
    throw new ServiceNowError(
      "ServiceNow instance is not configured. Use the servicenow_set_credentials tool first.",
    );
  }

  const host = resolveHost(instance);
  const base = `https://${host}`;
  const qs = params?.toString();
  const url = `${base}${path}${qs ? `?${qs}` : ""}`;
  const safeUrl = `${base}${path}`;
  const timeoutMs = getTimeoutMs();
  const maxRetries = getMaxRetries();

  const headers: Record<string, string> = {
    Accept: accept ?? "application/json",
  };
  let payload: string | Uint8Array | undefined;
  if (rawBody !== undefined) {
    payload = rawBody;
    if (contentType) headers["Content-Type"] = contentType;
  } else if (body !== undefined) {
    payload = JSON.stringify(body);
    headers["Content-Type"] = "application/json";
  }

  const started = Date.now();
  const telemetry = telemetryFor(host);
  telemetry.requests += 1;
  // A server-side token revocation surfaces as 401 before the cached token's
  // TTL runs out; one forced re-auth attempt recovers, a second 401 is real.
  // Optional client certificate (mutual TLS), built once per request.
  const dispatcher = await getTlsDispatcher();
  let retried401 = false;
  for (let attempt = 0; ; attempt++) {
    // Authorize per attempt: with long backoffs an OAuth token can expire
    // between tries (Basic is just a cheap base64; OAuth reads its cache).
    Object.assign(headers, await getAuthProvider().headers(host));
    let res: Response;
    try {
      // Node's fetch accepts Uint8Array bodies and a `dispatcher` (undici) at
      // runtime; the cast bridges gaps in the DOM RequestInit typing.
      const init: Record<string, unknown> = {
        method,
        headers,
        body: payload,
        signal: AbortSignal.timeout(timeoutMs),
      };
      if (dispatcher) init.dispatcher = dispatcher;
      res = await withSlot(host, () => fetch(url, init as RequestInit));
    } catch (cause) {
      const err = cause instanceof Error ? cause : new Error(String(cause));
      const timedOut = err.name === "TimeoutError" || err.name === "AbortError";
      // Only retry transport errors for idempotent requests, to avoid
      // duplicating non-idempotent writes whose outcome is unknown.
      if (isIdempotent(method) && attempt < maxRetries) {
        telemetry.retries += 1;
        await delay(backoffMs(attempt + 1));
        continue;
      }
      logger.warn("ServiceNow request failed (transport)", {
        method,
        path,
        timedOut,
        ms: Date.now() - started,
      });
      countError(telemetry, "transport");
      telemetry.totalMs += Date.now() - started;
      if (timedOut) {
        throw new ServiceNowError(
          `Request to ServiceNow timed out after ${timeoutMs}ms.`,
        );
      }
      throw new ServiceNowError(
        `Could not reach ServiceNow at ${safeUrl}: ${err.message}`,
      );
    }

    if (res.status === 401 && !retried401 && getAuthMode() === "oauth") {
      retried401 = true;
      telemetry.retries += 1;
      invalidateToken(host);
      await res.text().catch(() => undefined); // release the socket
      logger.debug("401 with cached OAuth token — re-authenticating once", {
        method,
        path,
      });
      continue;
    }

    if (
      !res.ok &&
      shouldRetryStatus(res.status, method) &&
      attempt < maxRetries
    ) {
      telemetry.retries += 1;
      const wait = retryAfterMs(res) ?? backoffMs(attempt + 1);
      await res.text().catch(() => undefined); // release the socket
      logger.debug("Retrying ServiceNow request", {
        method,
        path,
        status: res.status,
        attempt: attempt + 1,
        waitMs: wait,
      });
      await delay(wait);
      continue;
    }

    if (!res.ok) {
      const text = await res.text();
      let json: unknown = {};
      if (text) {
        try {
          json = JSON.parse(text);
        } catch {
          json = { raw: text };
        }
      }
      const detail =
        extractErrorDetail(json) || res.statusText || text || "(no detail)";
      logger.warn("ServiceNow API error", {
        method,
        path,
        status: res.status,
        ms: Date.now() - started,
      });
      countError(telemetry, res.status);
      telemetry.totalMs += Date.now() - started;
      throw new ServiceNowError(
        `ServiceNow API error (${res.status}): ${detail}`,
        res.status,
        json,
      );
    }

    const total = parseTotalCount(res);
    const responseContentType = res.headers.get("content-type") ?? undefined;
    telemetry.totalMs += Date.now() - started;
    logger.debug("ServiceNow request ok", {
      method,
      path,
      status: res.status,
      ms: Date.now() - started,
    });

    if (responseType === "binary") {
      const buf = Buffer.from(await res.arrayBuffer());
      return {
        data: buf.toString("base64") as unknown as T,
        total,
        status: res.status,
        contentType: responseContentType,
      };
    }

    const text = await res.text();
    let json: unknown = {};
    if (text) {
      try {
        json = JSON.parse(text);
      } catch {
        json = { raw: text };
      }
    }
    return {
      data: json as T,
      total,
      status: res.status,
      contentType: responseContentType,
    };
  }
}
