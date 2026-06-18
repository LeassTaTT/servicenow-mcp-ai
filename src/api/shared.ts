import { ServiceNowError } from "../core/errors.js";

/**
 * Unwrap the `result` envelope every ServiceNow REST API uses, with one shared
 * error message instead of a copy per call site.
 */
export function expectResult<T>(
  data: { result?: T } | null | undefined,
  api: string,
): T {
  if (!data || data.result == null) {
    throw new ServiceNowError(
      `Unexpected response from ServiceNow ${api}: missing 'result'.`,
    );
  }
  return data.result;
}

/**
 * Coerce a ServiceNow record value to a string. With sysparm_display_value=all
 * a field arrives as `{ value, display_value }` — stringifying that blindly
 * yields "[object Object]", so non-scalar values map to "" instead.
 */
export function snString(value: unknown): string {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return "";
}

/**
 * User-supplied fragments are embedded into encoded queries, where `^` acts as
 * the condition separator and ServiceNow has no escape for it inside LIKE — a
 * stray `^` would silently distort the filter (or inject extra clauses), so it
 * is rejected up front. Shared so every query builder enforces it identically.
 */
export function assertNoCaret(value: string, field: string): void {
  if (value.includes("^")) {
    throw new ServiceNowError(
      `The ${field} filter cannot contain '^' (it is the encoded-query separator and cannot be escaped).`,
      400,
    );
  }
}

/** Escape a value for a Markdown table cell so a `|` cannot break the column layout. */
export function mdEscape(value: string): string {
  return value.replaceAll("|", "\\|");
}

/**
 * Render a GitHub-flavoured Markdown table. Header and cell values are escaped
 * so a ServiceNow identifier containing `|` (e.g. a business-rule name) cannot
 * corrupt the row layout — shared so snapshot and compare reports stay
 * consistent (snapshot escaped, compare did not).
 */
export function mdTable(header: string[], rows: string[][]): string {
  return [
    `| ${header.map(mdEscape).join(" | ")} |`,
    `| ${header.map(() => "---").join(" | ")} |`,
    ...rows.map((r) => `| ${r.map(mdEscape).join(" | ")} |`),
  ].join("\n");
}

/** Like {@link expectResult}, but requires `result` to be an array. */
export function expectResultArray<T>(
  data: { result?: T[] } | null | undefined,
  api: string,
): T[] {
  if (!data || !Array.isArray(data.result)) {
    throw new ServiceNowError(
      `Unexpected response from ServiceNow ${api}: missing 'result' array.`,
    );
  }
  return data.result;
}
