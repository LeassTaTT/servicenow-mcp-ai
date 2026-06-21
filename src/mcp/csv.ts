import type { SnRecord } from "../api/table.js";

/**
 * Render records as RFC-4180 CSV for a spreadsheet-friendly export — a pure,
 * dependency-free formatter (XLSX would need a binary writer, so it is out of
 * scope for the zero-dependency build). Columns are the requested `fields`, or
 * the union of keys across the records when none are given. Values containing a
 * comma, quote or newline are quoted with inner quotes doubled; objects (e.g.
 * a `{ value, display_value }` field) are JSON-encoded so a row never breaks.
 */
export function toCsv(records: SnRecord[], fields?: string[]): string {
  const columns =
    fields && fields.length > 0
      ? fields
      : [...new Set(records.flatMap((r) => Object.keys(r)))];

  const cell = (value: unknown): string => {
    let s: string;
    if (value == null) s = "";
    else if (typeof value === "string") s = value;
    else if (typeof value === "number" || typeof value === "boolean") {
      s = String(value);
    } else s = JSON.stringify(value); // object/array (SN display_value fields)
    return /[",\n\r]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
  };

  const lines = [columns.map(cell).join(",")];
  for (const record of records) {
    lines.push(columns.map((c) => cell(record[c])).join(","));
  }
  return lines.join("\n");
}
