const path = require("node:path");

module.exports = {
  context: __dirname,
  entry: "./entry.mjs",
  experiments: { outputModule: true },
  mode: "production",
  output: {
    clean: true,
    filename: "tree-shaking.mjs",
    library: { type: "module" },
    module: true,
    path: path.resolve(__dirname, "dist-webpack"),
  },
  resolve: { mainFields: ["module", "main"] },
  target: ["web", "es2018"],
};
