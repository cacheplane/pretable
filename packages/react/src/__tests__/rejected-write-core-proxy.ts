/**
 * The `@pretable/core` module mock the four "an invalid X update is rejected,
 * not fatal" suites share, plus the arm/count handles their tests read.
 *
 * WHY THIS IS ITS OWN MODULE, SEPARATE FROM `rejected-write-harness.ts`: it
 * imports NOTHING, and must stay that way. `vi.mock` is hoisted above the test
 * file's imports, so its factory cannot close over anything the file declares —
 * the factory reaches this registry through a dynamic `import()` instead, and
 * that import runs WHILE the mocked `@pretable/core` module is still being
 * constructed. Anything reachable from here that imports `@pretable/core`
 * (which `rejected-write-harness.ts` does, for the shared `COLUMNS` fixture)
 * would re-enter that pending construction and hang the file. Test files import
 * the whole API from `rejected-write-harness.ts`, which re-exports this one.
 *
 * TWO TRAPS, both true of every suite that uses this.
 *
 * 1. The mock is MODULE-WIDE, unlike the narrower per-test seam one directory
 *    over (`vi.spyOn(core, "createLocalRowModel")` in `row-model-mode.test.tsx`).
 *    Every test in a file that installs it gets the proxy.
 *
 * 2. The proxy is NOT identity-transparent.
 *    `ɵsetLocalRowModelFilterAuthority` and `ɵsetLocalRowModelSortAuthority`
 *    look the model up in WeakMaps keyed by the RAW object and swallow a miss
 *    with `?.`, so those writes are silent no-ops for every test in such a file.
 *    Nothing in the four suites depends on filter/sort authority; A TEST THAT
 *    DID WOULD PASS VACUOUSLY. Write it somewhere else, or spy on the seam
 *    per-test instead.
 */

type Handle = {
  calls: number;
  armed: (() => Error) | null;
};

/**
 * Keyed by intercepted method name, so the `vi.mock` factory (which runs before
 * the test file's own body) and the test file's `rowModelMethodProxy(...)` call
 * reach the SAME state. Module state, therefore per test FILE: vitest gives
 * each file its own module registry, so nothing leaks between suites.
 */
const handles = new Map<string, Handle>();

function handleFor(methodName: string): Handle {
  const existing = handles.get(methodName);
  if (existing !== undefined) {
    return existing;
  }
  const created: Handle = { calls: 0, armed: null };
  handles.set(methodName, created);
  return created;
}

/** Arm and count one intercepted row-model method. */
export type RowModelMethodProxy = {
  /**
   * Make the NEXT call throw what `makeError` returns, then disarm itself.
   * Disarmed by default, so every unarmed test runs the real model.
   */
  armThrow(makeError: () => Error): void;
  /** Calls to the intercepted method since the last reset. */
  callCount(): number;
};

/**
 * Get the handle for `methodName`, creating it if the `vi.mock` factory has not
 * already. Repeated calls for one name share state by design — that is how the
 * factory and the test body meet.
 */
export function rowModelMethodProxy(methodName: string): RowModelMethodProxy {
  const handle = handleFor(methodName);
  return {
    armThrow(makeError: () => Error): void {
      handle.armed = makeError;
    },
    callCount(): number {
      return handle.calls;
    },
  };
}

/**
 * Zero the count and disarm EVERY handle in the registry — not merely the ones
 * a test file happened to name. `installWarnSpy` calls this around each test.
 *
 * Sweeping the whole registry is what removes the footgun: nothing couples the
 * method names passed to `proxiedCoreModule` to the handles a file remembers to
 * hand around, so a file that intercepts a method and then forgets it would
 * otherwise get no per-test reset, and a stale count or a leftover armed throw
 * would leak silently into the next test. The registry is per-file module
 * state, so this can never reach another suite.
 */
export function resetRowModelProxies(): void {
  for (const handle of handles.values()) {
    handle.calls = 0;
    handle.armed = null;
  }
}

/**
 * The body of the per-file `vi.mock("@pretable/core", ...)` factory. The
 * one-liner has to stay in each test file — `vi.mock` is hoisted and the path
 * must be statically visible — but everything it does lives here:
 *
 * ```ts
 * vi.mock("@pretable/core", async (importOriginal) => {
 *   const { proxiedCoreModule } = await import("./rejected-write-core-proxy");
 *   return proxiedCoreModule(importOriginal, "setRows");
 * });
 * ```
 *
 * Every listed method is counted; each can be armed independently through its
 * own `rowModelMethodProxy(name)` handle. Unlisted methods pass straight
 * through.
 */
export async function proxiedCoreModule(
  importOriginal: <T>() => Promise<T>,
  ...methodNames: readonly string[]
): Promise<Record<string, unknown>> {
  const actual = await importOriginal<Record<string, unknown>>();
  const intercepted = new Map<string, Handle>(
    methodNames.map((name) => [name, handleFor(name)]),
  );
  return {
    ...actual,
    createLocalRowModel: (...args: readonly unknown[]) => {
      const model = (
        actual.createLocalRowModel as unknown as (
          ...a: readonly unknown[]
        ) => object
      )(...args);
      return new Proxy(model, {
        get(target, property, receiver) {
          const value = Reflect.get(target, property, receiver) as unknown;
          if (typeof property !== "string") return value;
          const handle = intercepted.get(property);
          if (handle === undefined) return value;
          return (...callArgs: readonly unknown[]) => {
            handle.calls += 1;
            const make = handle.armed;
            if (make !== null) {
              handle.armed = null;
              throw make();
            }
            return (value as (...a: readonly unknown[]) => unknown)(
              ...callArgs,
            );
          };
        },
      });
    },
  };
}
