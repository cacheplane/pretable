const path = require("node:path");

module.exports = {
  context: __dirname,
  entry: "./entry-esm.mjs",
  mode: "production",
  output: {
    clean: true,
    filename: "bundle.js",
    path: path.resolve(__dirname, "dist-esm"),
  },
  resolve: { exportsFields: [], mainFields: ["module", "main"] },
  module: { rules: [{ test: /\.css$/u, type: "asset/source" }] },
  target: ["web", "es2018"],
};
