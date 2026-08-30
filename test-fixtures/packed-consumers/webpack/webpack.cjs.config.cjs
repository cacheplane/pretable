const path = require("node:path");

module.exports = {
  context: __dirname,
  entry: "./entry-cjs.cjs",
  mode: "production",
  output: {
    clean: true,
    filename: "bundle.js",
    path: path.resolve(__dirname, "dist-cjs"),
  },
  resolve: { exportsFields: [], mainFields: ["main"] },
  target: ["web", "es2018"],
};
