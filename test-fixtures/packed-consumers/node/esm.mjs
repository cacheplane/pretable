const modules = {
  core: await import("@pretable/core"),
  react: await import("@pretable/react"),
  streamAdapter: await import("@pretable/stream-adapter"),
  ui: await import("@pretable/ui"),
};

const inventory = Object.fromEntries(
  Object.entries(modules).map(([name, module]) => [
    name,
    Object.keys(module).sort(),
  ]),
);

if (typeof modules.core.createGrid !== "function") {
  throw new Error("@pretable/core representative export is missing");
}
if (typeof modules.react.Pretable !== "function") {
  throw new Error("@pretable/react representative export is missing");
}
if (typeof modules.streamAdapter.createBatcher !== "function") {
  throw new Error("@pretable/stream-adapter representative export is missing");
}
if (typeof modules.ui.getDensityHeights !== "function") {
  throw new Error("@pretable/ui representative export is missing");
}

process.stdout.write(`${JSON.stringify(inventory)}\n`);
