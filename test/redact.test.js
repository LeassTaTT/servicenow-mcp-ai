import test from "node:test";
import assert from "node:assert/strict";

import { redactRecords } from "../build/mcp/redact.js";
import { baselineEnv, withEnv } from "./helpers.js";

baselineEnv();

test("redaction is a no-op when nothing is configured (DF-5)", () => {
  const r = redactRecords([{ email: "a@b.com", name: "Al" }]);
  assert.equal(r.redacted, 0);
  assert.equal(r.records[0].email, "a@b.com");
});

test("SN_REDACT_FIELDS masks the named fields outright (DF-5)", async () => {
  await withEnv({ SN_REDACT_FIELDS: "email,phone" }, () => {
    const r = redactRecords([{ email: "a@b.com", phone: "123", name: "Al" }]);
    assert.equal(r.records[0].email, "[redacted]");
    assert.equal(r.records[0].phone, "[redacted]");
    assert.equal(r.records[0].name, "Al"); // untouched
    assert.equal(r.redacted, 2);
  });
});

test("named-field redaction leaves empty values untouched (DF-5)", async () => {
  await withEnv({ SN_REDACT_FIELDS: "email" }, () => {
    const r = redactRecords([{ email: "", name: "Al" }]);
    assert.equal(r.records[0].email, "");
    assert.equal(r.redacted, 0);
  });
});

test("SN_REDACT_PII masks emails/phones/ids inside string values (DF-5)", async () => {
  await withEnv({ SN_REDACT_PII: "true" }, () => {
    const r = redactRecords([
      { note: "reach me at a@b.com or 555-123-4567", ssn: "123456789" },
    ]);
    assert.match(r.records[0].note, /\[redacted\]/);
    assert.equal(r.records[0].note.includes("a@b.com"), false);
    assert.equal(r.records[0].ssn, "[redacted]");
    assert.ok(r.redacted >= 2);
  });
});
