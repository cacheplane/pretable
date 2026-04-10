import test from "node:test";
import assert from "node:assert/strict";

import { normalizeBenchE2EArgs } from "../bench-e2e.mjs";

test("normalizeBenchE2EArgs preserves direct Playwright flags", () => {
  assert.deepEqual(normalizeBenchE2EArgs(["--project=chromium"]), [
    "--project=chromium",
  ]);
});

test("normalizeBenchE2EArgs strips pnpm's standalone double dash separator", () => {
  assert.deepEqual(normalizeBenchE2EArgs(["--", "--project=chromium"]), [
    "--project=chromium",
  ]);
});
