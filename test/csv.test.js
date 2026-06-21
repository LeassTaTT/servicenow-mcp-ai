import test from "node:test";
import assert from "node:assert/strict";

import { toCsv } from "../build/mcp/csv.js";

test("toCsv renders a header and rows from the field order", () => {
  const csv = toCsv(
    [{ number: "INC1", priority: "1" }],
    ["number", "priority"],
  );
  assert.equal(csv, "number,priority\nINC1,1");
});

test("toCsv quotes values containing comma, quote or newline", () => {
  const csv = toCsv(
    [{ a: "x,y", b: 'he said "hi"', c: "line1\nline2" }],
    ["a", "b", "c"],
  );
  assert.equal(csv, 'a,b,c\n"x,y","he said ""hi""","line1\nline2"');
});

test("toCsv falls back to the union of keys when no fields are given", () => {
  const csv = toCsv([{ a: "1" }, { b: "2" }]);
  assert.equal(csv, "a,b\n1,\n,2");
});

test("toCsv JSON-encodes object values (display_value fields) so a row stays intact", () => {
  const csv = toCsv(
    [{ ref: { value: "abc", display_value: "Alice" } }],
    ["ref"],
  );
  // The object is JSON-encoded and, since it contains a comma, quoted.
  assert.match(csv, /^ref\n".*abc.*Alice.*"$/);
});

test("toCsv renders null/undefined as an empty cell", () => {
  const csv = toCsv([{ a: null, b: undefined, c: 0 }], ["a", "b", "c"]);
  assert.equal(csv, "a,b,c\n,,0");
});
