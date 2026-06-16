import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { buildManifest, FIXTURE_PATH } from "../scripts/gen-manifest.mjs";

test("the tool manifest matches the checked-in fixture (M-6)", () => {
  const fixture = JSON.parse(readFileSync(FIXTURE_PATH, "utf8"));
  assert.deepEqual(
    buildManifest(),
    fixture,
    "Tool surface changed — if intentional, run `npm run gen:manifest` and commit the fixture diff",
  );
});
