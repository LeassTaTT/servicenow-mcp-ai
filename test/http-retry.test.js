import test from "node:test";
import assert from "node:assert/strict";

import { queryTable, createRecord, ServiceNowError } from "../build/servicenow.js";
import { baselineEnv, withEnv, withFetch, jsonResponse } from "./helpers.js";

baselineEnv();

test("a GET transport error is retried", async () => {
  await withEnv({ SN_MAX_RETRIES: "1" }, () =>
    withFetch(
      (_url, _init, callNo) => {
        if (callNo === 1) throw new TypeError("fetch failed");
        return jsonResponse(200, { result: [] });
      },
      async (calls) => {
        const { records } = await queryTable({ table: "incident" });
        assert.equal(records.length, 0);
        assert.equal(calls.length, 2);
      },
    ),
  );
});

test("a POST transport error is NOT retried (outcome unknown)", async () => {
  await withEnv({ SN_MAX_RETRIES: "2" }, () =>
    withFetch(
      () => {
        throw new TypeError("socket hang up");
      },
      async (calls) => {
        await assert.rejects(
          createRecord("incident", { short_description: "x" }),
          /Could not reach ServiceNow/,
        );
        assert.equal(calls.length, 1);
      },
    ),
  );
});

test("Retry-After given as an HTTP date is honoured", async () => {
  await withEnv({ SN_MAX_RETRIES: "1" }, () =>
    withFetch(
      (_url, _init, callNo) =>
        callNo === 1
          ? jsonResponse(
              429,
              { error: { message: "slow down" } },
              // A date in the past => zero wait, keeps the test fast.
              { "retry-after": new Date(Date.now() - 1000).toUTCString() },
            )
          : jsonResponse(200, { result: [{ ok: true }] }),
      async (calls) => {
        const { records } = await queryTable({ table: "incident" });
        assert.equal(records.length, 1);
        assert.equal(calls.length, 2);
      },
    ),
  );
});

test("a 502 is retried for GET but not for POST", async () => {
  await withEnv({ SN_MAX_RETRIES: "1" }, async () => {
    // GET: first 502, then success.
    await withFetch(
      (_url, _init, callNo) =>
        callNo === 1
          ? jsonResponse(502, {}, { "retry-after": "0" })
          : jsonResponse(200, { result: [] }),
      async (calls) => {
        await queryTable({ table: "incident" });
        assert.equal(calls.length, 2);
      },
    );
    // POST: a received 502 must surface immediately (the write may have landed).
    await withFetch(
      () => jsonResponse(502, { error: { message: "bad gateway" } }),
      async (calls) => {
        await assert.rejects(
          createRecord("incident", { short_description: "x" }),
          (err) => err instanceof ServiceNowError && err.status === 502,
        );
        assert.equal(calls.length, 1);
      },
    );
  });
});
