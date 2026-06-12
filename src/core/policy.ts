import { ServiceNowError } from "./errors.js";
import { activeProfile } from "./config.js";

/**
 * Access policy for ServiceNow tables and operations, configured via env:
 *
 * - `SN_TABLES_ALLOW`  comma-separated allowlist; when set, only these tables
 *                      are reachable.
 * - `SN_TABLES_DENY`   comma-separated denylist; always wins over the allowlist.
 * - `SN_READONLY`      when truthy, every write (create/update/delete) is refused.
 *
 * Per-profile overrides (MI-2): `SN_PROFILE_<NAME>_READONLY` / `_TABLES_ALLOW`
 * / `_TABLES_DENY` apply when that profile is active and fall back to the
 * global keys — the real-world setup "prod is read-only, dev has full rights"
 * in one server.
 *
 * Enforced in the client layer so all tool and resource paths share one guard.
 */

/** Read a policy env var: the profile's override first, then the global key. */
function policyValue(
  suffix: string,
  profile: string = activeProfile(),
): string | undefined {
  if (profile !== "default") {
    const scoped = process.env[`SN_PROFILE_${profile.toUpperCase()}_${suffix}`];
    if (scoped !== undefined) return scoped;
  }
  return process.env[`SN_${suffix}`];
}

function list(suffix: string, profile?: string): string[] {
  return (policyValue(suffix, profile) ?? "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

export function getAllowedTables(profile?: string): string[] {
  return list("TABLES_ALLOW", profile);
}

export function getDeniedTables(profile?: string): string[] {
  return list("TABLES_DENY", profile);
}

export function isReadOnly(profile?: string): boolean {
  const raw = (policyValue("READONLY", profile) ?? "").trim().toLowerCase();
  return raw === "1" || raw === "true" || raw === "yes" || raw === "on";
}

/** Throw a 403-style ServiceNowError when the table is not permitted. */
export function assertTableAllowed(table: string): void {
  const t = table.trim().toLowerCase();
  if (getDeniedTables().includes(t)) {
    throw new ServiceNowError(
      `Access to table "${table}" is denied by SN_TABLES_DENY.`,
      403,
    );
  }
  const allowed = getAllowedTables();
  if (allowed.length > 0 && !allowed.includes(t)) {
    throw new ServiceNowError(
      `Access to table "${table}" is not permitted by SN_TABLES_ALLOW.`,
      403,
    );
  }
}

/** Throw a 403-style ServiceNowError when the server is in read-only mode. */
export function assertWriteAllowed(operation: string): void {
  if (isReadOnly()) {
    throw new ServiceNowError(
      `Server is in read-only mode (SN_READONLY); "${operation}" is not permitted.`,
      403,
    );
  }
}
