import assert from "node:assert/strict";
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

/**
 * **The invariant: a workspace script builds its own package and nothing else.**
 *
 * The dependency graph is declared once — in each `package.json`'s
 * `dependencies` — and `pnpm -r` already runs scripts in topological order, so
 * a package's dependencies are built before its own script starts. Nothing
 * needs to restate that order.
 *
 * The defect this guard closes was a second, hand-written copy of the graph
 * living inside the script strings: `@pretable/core`'s `test` began
 * `pnpm --filter @pretable-internal/grid-core build && …`, and
 * `@pretable-internal/renderer-dom`'s began with three such prefixes. Those two
 * packages are topological *siblings* — both depend on `grid-core`, neither on
 * the other — so pnpm starts them at the same instant, and each then re-built
 * packages pnpm had already built moments earlier. A cold `pnpm -r --filter
 * './packages/*' build` showed both siblings launching within the same second
 * and immediately re-running `tsc -b` over `layout-core`.
 *
 * Two `tsc -b` processes emitting one `dist/` is unsafe by construction:
 * `writeFileSync` truncates before it writes, so a concurrent reader can see
 * `layout-core/dist/index.d.ts` empty and report "is not a module". Measured
 * directly, two cold `tsc -b` runs launched together emitted that file twice in
 * 2 of 3 runs and once in the third — the nondeterminism *is* the race. It
 * failed the required `typecheck` gate intermittently, which is the corrosive
 * kind of flake: it teaches people to re-run until green.
 *
 * **What is still allowed.** An app's `prepare:deps` legitimately builds its
 * dependency closure so `pnpm --filter <app> dev` works standalone. It must do
 * so with a *derived* filter — pnpm's `<pkg>^...` (dependencies of, excluding)
 * or `<pkg>...` (package and its dependencies) — which reads the closure back
 * out of `package.json` and stays correct when the graph changes. What this
 * guard forbids is naming a sibling package literally, because that is the copy
 * that goes stale and the copy that overlaps.
 *
 * **What makes it self-enforcing.** The package set is discovered from the
 * workspace, not listed here, so a package added tomorrow is covered with no
 * edit. A literal filter naming a package that no longer exists fails too,
 * rather than being quietly skipped.
 */

const REPO_ROOT = fileURLToPath(new URL("../..", import.meta.url));

/** Every workspace package name, discovered rather than listed. */
function workspacePackages() {
  const names = new Map();
  for (const group of ["packages", "apps"]) {
    const dir = join(REPO_ROOT, group);
    if (!existsSync(dir)) continue;
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const manifest = join(dir, entry.name, "package.json");
      if (!existsSync(manifest)) continue;
      const pkg = JSON.parse(readFileSync(manifest, "utf8"));
      names.set(pkg.name, { manifest, rel: `${group}/${entry.name}`, pkg });
    }
  }
  return names;
}

/**
 * Pull every `--filter <arg>` out of a script string, with the quoting pnpm
 * accepts. Returns the raw argument so the caller can judge derived-vs-literal.
 */
function filterArgs(script) {
  const args = [];
  const re = /--filter\s+(?:'([^']*)'|"([^"]*)"|(\S+))/g;
  for (const m of script.matchAll(re)) args.push(m[1] ?? m[2] ?? m[3]);
  return args;
}

/**
 * A path filter selects by directory (`./packages/*`), not by name. Note that
 * a *slash alone* does not mean a path — every scoped package name has one, so
 * testing for `/` anywhere skips `@pretable-internal/grid-core` and blinds the
 * whole guard. Only a leading `.`/`/` or a glob marks a path.
 */
function isPathFilter(arg) {
  return arg.startsWith(".") || arg.startsWith("/") || arg.includes("*");
}

const PACKAGES = workspacePackages();

test("no workspace script builds a sibling by name", () => {
  const offenders = [];
  for (const [name, { rel, pkg }] of PACKAGES) {
    for (const [scriptName, body] of Object.entries(pkg.scripts ?? {})) {
      for (const arg of filterArgs(String(body))) {
        // Derived closures (`x...`, `x^...`) and path globs are the sanctioned
        // forms — they are recomputed from the graph, not restated.
        if (arg.endsWith("...") || isPathFilter(arg)) continue;
        if (arg === name) continue; // filtering to yourself is a no-op, not a graph copy
        if (PACKAGES.has(arg))
          offenders.push(`${rel} -> scripts.${scriptName}: --filter ${arg}`);
      }
    }
  }

  assert.deepEqual(
    offenders,
    [],
    "These scripts name another workspace package literally, which restates a " +
      "dependency graph pnpm already honours topologically — and lets " +
      "topological siblings build the same package at the same time.\n\n" +
      offenders.map((o) => `  ${o}`).join("\n") +
      "\n\nRemedy: delete the prefix and let `pnpm -r` order the build. If the " +
      "script genuinely needs its dependency closure built (an app's " +
      "`prepare:deps`), use the derived filter `<pkg>^...` instead of naming " +
      "packages one by one.",
  );
});

test("every literal --filter argument names a package that exists", () => {
  const dangling = [];
  for (const [, { rel, pkg }] of PACKAGES) {
    for (const [scriptName, body] of Object.entries(pkg.scripts ?? {})) {
      for (const arg of filterArgs(String(body))) {
        if (isPathFilter(arg)) continue;
        const bare = arg.replace(/\^?\.\.\.$/, "");
        if (bare && !PACKAGES.has(bare))
          dangling.push(`${rel} -> scripts.${scriptName}: --filter ${arg}`);
      }
    }
  }
  assert.deepEqual(
    dangling,
    [],
    "A --filter names a workspace package that does not exist. pnpm treats an " +
      "unmatched filter as an empty selection and exits 0, so the build it was " +
      "supposed to run silently does not happen.\n\n" +
      dangling.map((d) => `  ${d}`).join("\n"),
  );
});

test("the guard is discovering the real workspace", () => {
  // A guard that silently discovers nothing passes vacuously forever.
  assert.ok(
    PACKAGES.size >= 10,
    `expected to discover the workspace, found ${PACKAGES.size} packages`,
  );
  assert.ok(PACKAGES.has("@pretable/core"));
  assert.ok(PACKAGES.has("@pretable-internal/renderer-dom"));
});
