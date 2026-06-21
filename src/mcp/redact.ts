import { getRedactFields, redactPII } from "../core/settings.js";
import type { SnRecord } from "../api/table.js";

/**
 * DF-5 — client-side redaction. Sensitive values are masked **before** records
 * are serialised for the model, so they never leave this process. Named fields
 * (`SN_REDACT_FIELDS`) are masked outright; with `SN_REDACT_PII`, string values
 * that match an email/phone/national-id pattern are masked too. This is the
 * honest backing for the "bring-your-own-model, nothing sensitive leaks" story.
 */

const REDACTED = "[redacted]";

const PII_PATTERNS: RegExp[] = [
  /[\w.+-]+@[\w-]+\.[\w.-]+/g, // email
  /\b\+?\d[\d ()-]{7,}\d\b/g, // phone
  /\b\d{9,}\b/g, // long national-id digit run
];

function redactString(value: string): { value: string; hits: number } {
  let hits = 0;
  let out = value;
  for (const re of PII_PATTERNS) {
    out = out.replace(re, () => {
      hits++;
      return REDACTED;
    });
  }
  return { value: out, hits };
}

export interface RedactionResult {
  records: SnRecord[];
  /** Total number of values/matches masked (0 when redaction is off). */
  redacted: number;
}

/**
 * Mask sensitive values in a record set. Returns the (possibly new) records and
 * the number of redactions. A no-op — same array, `redacted: 0` — when neither
 * `SN_REDACT_FIELDS` nor `SN_REDACT_PII` is configured, so the default path pays
 * nothing.
 */
export function redactRecords(records: SnRecord[]): RedactionResult {
  const fields = new Set(getRedactFields());
  const pii = redactPII();
  if (fields.size === 0 && !pii) return { records, redacted: 0 };

  let redacted = 0;
  const out = records.map((rec) => {
    const copy: SnRecord = {};
    for (const [key, value] of Object.entries(rec)) {
      if (fields.has(key) && value != null && value !== "") {
        copy[key] = REDACTED;
        redacted++;
      } else if (pii && typeof value === "string") {
        const r = redactString(value);
        copy[key] = r.value;
        redacted += r.hits;
      } else {
        copy[key] = value;
      }
    }
    return copy;
  });
  return { records: out, redacted };
}
