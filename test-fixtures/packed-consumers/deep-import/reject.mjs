import assert from "node:assert/strict";

await assert.rejects(
  import("@pretable/core/dist/index.mjs"),
  (error) => error?.code === "ERR_PACKAGE_PATH_NOT_EXPORTED",
);
