import test from "node:test";
import assert from "node:assert/strict";

import { pluginCall } from "../build/api/plugin.js";
import { ServiceNowError } from "../build/errors.js";

test("pluginCall annotates 404s with the inactive-plugin hint", async () => {
  await assert.rejects(
    pluginCall("Knowledge", async () => {
      throw new ServiceNowError("ServiceNow API error (404): Not found", 404, {
        marker: 1,
      });
    }),
    (err) =>
      err instanceof ServiceNowError &&
      err.status === 404 &&
      /Knowledge API\/plugin may not be active/.test(err.message) &&
      err.detail?.marker === 1,
  );
});

test("pluginCall passes non-404 errors through untouched", async () => {
  const original = new ServiceNowError("denied", 403);
  await assert.rejects(
    pluginCall("Knowledge", async () => {
      throw original;
    }),
    (err) => err === original,
  );
});

test("pluginCall returns the wrapped result on success", async () => {
  assert.equal(await pluginCall("Knowledge", async () => 42), 42);
});
