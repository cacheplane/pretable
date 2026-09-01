import {
  rejectedWriteEquals,
  type PretableRejectedWrite,
} from "./rejected-write";

/**
 * The bridge from `useLocalRowModel`'s rejected-write guards to
 * `usePretable`'s public `rejectedWrites` record.
 *
 * A consumer doing `useLocalRowModel({rows})` + `<PretableSurface model={m}>`
 * never runs `usePretable`'s rows guard — the rejection happens in
 * `useLocalRowModel`'s own layout effect. Without this channel the public
 * record would answer "in sync" for a grid that is diverged: a false negative
 * worse than no API.
 *
 * A Symbol-keyed property on the MODEL INSTANCE, not a WeakMap: the sibling
 * WeakMap channels (`ɵsetLocalRowModelFilterAuthority`) are documented in the
 * rejected suites as silently missing under a test proxy, which is exactly
 * the failure shape this API exists to remove. Both ends live in this
 * package; nothing crosses a package boundary and core/row-model stay
 * unaware.
 *
 * The channel carries FAULTS only, no refused identities: `useLocalRowModel`
 * owns its own `lastRows`/`lastDerivations` gates and publishes
 * attempt-by-attempt, so clearing is decided at the guard, not by the reader.
 * The clear therefore lands in the recovering commit's layout effect — one
 * notifying-store publish before paint — rather than during the recovering
 * render as `usePretable`'s own rows slot does; nothing reads these faults
 * during render for count math, so #561's one-render-early requirement does
 * not apply here.
 *
 * QUERY IS ABSENT by construction: `useLocalRowModel` performs no query
 * write, and in model mode `usePretable`'s own effect returns early, so the
 * merged record's `query` slot is always null for this entry point.
 */
export interface LocalRejectedWriteSlots {
  readonly rows: PretableRejectedWrite | null;
  readonly derivations: PretableRejectedWrite | null;
}

export const EMPTY_LOCAL_SLOTS: LocalRejectedWriteSlots = Object.freeze({
  rows: null,
  derivations: null,
});

export interface LocalRejectedWritesStore {
  readonly subscribe: (listener: () => void) => () => void;
  readonly getSnapshot: () => LocalRejectedWriteSlots;
  readonly publish: (next: LocalRejectedWriteSlots) => void;
}

const LOCAL_REJECTED_WRITES = Symbol("pretable.localRejectedWrites");

export function createLocalRejectedWritesStore(): LocalRejectedWritesStore {
  let snapshot = EMPTY_LOCAL_SLOTS;
  const listeners = new Set<() => void>();
  return {
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    getSnapshot: () => snapshot,
    publish(next) {
      const rows = rejectedWriteEquals(snapshot.rows, next.rows)
        ? snapshot.rows
        : next.rows;
      const derivations = rejectedWriteEquals(
        snapshot.derivations,
        next.derivations,
      )
        ? snapshot.derivations
        : next.derivations;
      if (snapshot.rows === rows && snapshot.derivations === derivations) {
        return;
      }
      snapshot = { rows, derivations };
      for (const listener of Array.from(listeners)) listener();
    },
  };
}

/**
 * Non-enumerable so serialization/spreads of the model never see it.
 * Call at most once per model: the property is non-configurable, so a second
 * attach throws rather than silently replacing the store.
 */
export function attachLocalRejectedWrites(
  model: object,
  store: LocalRejectedWritesStore,
): void {
  Object.defineProperty(model, LOCAL_REJECTED_WRITES, { value: store });
}

export function readLocalRejectedWrites(
  model: object,
): LocalRejectedWritesStore | undefined {
  return (model as Record<PropertyKey, unknown>)[LOCAL_REJECTED_WRITES] as
    LocalRejectedWritesStore | undefined;
}
