import type { LoadedExample } from "./define";
import { exampleDir, loadExampleFiles } from "./load";
import { exampleRegistry, type ExampleId } from "./registry.generated";

/**
 * Narrows an arbitrary string (e.g. a route param) to a registered
 * `ExampleId`. `Object.hasOwn` — not `in` or a truthy check on
 * `exampleRegistry[value]` — because a plain object's prototype chain makes
 * `"constructor"`, `"toString"`, and `"valueOf"` resolve to something truthy
 * even though they were never registered.
 */
export function isExampleId(value: string): value is ExampleId {
  return Object.hasOwn(exampleRegistry, value);
}

/**
 * Shared diagnostic for an id that isn't in `exampleRegistry` — lists every
 * registered id and the fix. Exported so any caller that has already
 * narrowed via `isExampleId` (and therefore never reaches `loadExample`'s own
 * use of this message) can still surface the same actionable text instead of
 * inventing a thinner one.
 */
export function unknownIdMessage(id: string): string {
  const known = Object.keys(exampleRegistry).sort().join(", ");
  return (
    `Unknown example id: "${id}". Registered ids: ${known}. ` +
    "If you just added content/examples/<id>/example.ts, run " +
    "`pnpm examples:gen` and commit the regenerated registry."
  );
}

const cache = new Map<ExampleId, Promise<LoadedExample>>();

/**
 * Registry-aware load, memoised per id. Pages are statically rendered, so each
 * file is read and highlighted once per build.
 *
 * `id` is validated against the registry *before* touching the cache, so an
 * unregistered id (a typo'd slug, a route param that was never a real
 * example) never occupies a cache slot — important once a route handler
 * takes a bare `string` and Next's default `dynamicParams` would otherwise
 * let every distinct bad slug grow the map for the life of the process. A
 * failed load's rejection is evicted from the cache rather than memoised, so
 * a transient error (e.g. `EMFILE`) doesn't pin a real example to a
 * permanent failure — the next call gets a fresh attempt.
 */
export function loadExample(id: ExampleId): Promise<LoadedExample> {
  if (!isExampleId(id)) {
    return Promise.reject(new Error(unknownIdMessage(id)));
  }
  let hit = cache.get(id);
  if (!hit) {
    hit = loadOne(id).catch((err: unknown) => {
      cache.delete(id);
      throw err;
    });
    cache.set(id, hit);
  }
  return hit;
}

async function loadOne(id: ExampleId): Promise<LoadedExample> {
  const entry = exampleRegistry[id];
  const files = await loadExampleFiles(exampleDir(id), entry.meta);
  return { id, meta: entry.meta, files, hasDemo: entry.hasDemo };
}
