import {
  createLocalRowModel,
  type CreateLocalRowModelOptions,
  type CreateLocalRowModelWithDefaultIdOptions,
  type PretableDerivationsFor,
  type PretableRowId,
  type PretableRowModel,
} from "@pretable/core";
import { useLayoutEffect, useRef, useState } from "react";

import {
  compiledQueryGuard,
  reportRejectedWrite,
  rowModelCodeGuard,
} from "./rejected-write";
import type {
  PretableConventionalRowId,
  PretableRowForColumns,
} from "./use-pretable";

/** React options for the conventional `row.id` local-model path. @public */
export type UseLocalRowModelWithDefaultIdOptions<TColumns> =
  CreateLocalRowModelWithDefaultIdOptions<TColumns> & {
    readonly derivations?: PretableDerivationsFor<TColumns>;
  };

/** React options for a local model with an explicit row-ID accessor. @public */
export type UseLocalRowModelOptions<
  TColumns,
  TRowId extends PretableRowId,
> = CreateLocalRowModelOptions<TColumns, TRowId> & {
  readonly derivations?: PretableDerivationsFor<TColumns>;
};

/**
 * Creates one local row model for the committed mount, reconciles declarative
 * rows and derivations after commit, and disposes the owned model on unmount.
 *
 * @public
 */
export function useLocalRowModel<
  const TColumns extends readonly [unknown, ...(readonly unknown[])],
>(
  options: UseLocalRowModelWithDefaultIdOptions<TColumns>,
): PretableRowModel<
  PretableRowForColumns<TColumns>,
  PretableConventionalRowId<PretableRowForColumns<TColumns>>,
  TColumns
>;
/** @public */
export function useLocalRowModel<
  const TColumns extends readonly [unknown, ...(readonly unknown[])],
  const TRowId extends PretableRowId,
>(
  options: UseLocalRowModelOptions<TColumns, TRowId>,
): PretableRowModel<PretableRowForColumns<TColumns>, TRowId, TColumns>;
export function useLocalRowModel(rawOptions: unknown): unknown {
  const options = rawOptions as {
    readonly rows: readonly object[];
    readonly columns: readonly unknown[];
    readonly derivations?: readonly unknown[];
  };
  const [model] = useState(
    () =>
      createLocalRowModel(rawOptions as never) as unknown as {
        setRows(rows: readonly object[]): unknown;
        setDerivations(derivations: never): {
          readonly finished: Promise<number>;
        };
        dispose(): void;
      },
  );
  const lastRows = useRef(options.rows);
  const initialDerivations = options.derivations ?? options.columns;
  const lastDerivations = useRef(initialDerivations);
  const disposalGeneration = useRef(0);

  useLayoutEffect(() => {
    if (lastRows.current !== options.rows) {
      /*
       * Recorded BEFORE the call that can throw, and deliberately NOT rolled
       * back if it does — the derivations rule below, for the same reason: the
       * rejected array stays here as "last requested", so an invalid update is
       * attempted ONCE instead of being retried on every later render.
       * Recovery is unaffected; a later valid array is a new identity, so this
       * gate opens for it.
       */
      lastRows.current = options.rows;
      try {
        model.setRows(options.rows as readonly object[]);
      } catch (error) {
        /*
         * An invalid `rows` option is a REJECTED WRITE, not a fatal one: this
         * runs in a layout effect, so a throw escapes the commit and React
         * unmounts whatever subtree renders this model — measured on this hook
         * at three rendered rows going to zero, and 5996 bytes of markup to
         * zero, for an ordinary duplicate row id.
         *
         * The kept value is a STRONGER claim than the derivations twin below
         * makes. Stale derivations are a display nuance; stale ROWS mean the
         * consumer's data and the screen have diverged, which is why the
         * message says so in as many words.
         *
         * No transition to chain: `setRows` returns a synchronous
         * `PretableMutationResult`, not a transition with a `finished`
         * promise.
         *
         * Which codes are accepted, and why acceptance is by code rather than
         * name, is documented on `rowModelCodeGuard` in `./rejected-write`.
         * The `local-` prefix on the warn key is what keeps this hook's latch
         * distinct from `usePretable`'s `rows-rejected`: `warnOnce` latches per
         * key, so a shared prefix would let either hook silence the other.
         */
        reportRejectedWrite(
          error,
          rowModelCodeGuard(
            "local-rows-rejected",
            ({ columnId, detail }) =>
              "[pretable] A rows update was rejected as invalid" +
              (columnId === undefined ? "" : ` on column "${columnId}"`) +
              /*
               * Trailing "." stripped so the sentence ends with exactly one.
               * Row-model messages are written as full sentences
               * (`row-store.ts:116` → `Duplicate row ID dup.`), which rendered
               * as `…Duplicate row ID dup.. The model kept…`. Unpunctuated
               * details are reachable too, so normalise rather than assume:
               * one is stripped, one is added back.
               */
              `: ${detail.replace(/\.$/, "")}. The row model kept its previous ` +
              "rows, so it is holding data from before this update and the " +
              "rows it reports no longer match the ones you passed. Correct " +
              "the rows, or drop the change.",
          ),
        );
      }
    }
    const derivations = options.derivations ?? options.columns;
    if (lastDerivations.current !== derivations) {
      /*
       * Recorded BEFORE the call that can throw, and deliberately NOT rolled
       * back, for the reason given on the rows gate above.
       */
      lastDerivations.current = derivations;
      let transition: { readonly finished: Promise<number> } | undefined;
      try {
        transition = model.setDerivations(derivations as never);
      } catch (error) {
        /*
         * An invalid derivations update is a REJECTED WRITE, not a fatal one,
         * for the same layout-effect reason as the rows gate above. The row
         * model keeps the derivations it already had. What rethrows and how
         * the warning is keyed are documented on `reportRejectedWrite` in
         * `./rejected-write`; acceptance is per-guard, and this one's — by
         * error NAME, unlike `rowModelCodeGuard`'s by code — is documented on
         * `compiledQueryGuard` there.
         */
        reportRejectedWrite(
          error,
          compiledQueryGuard(
            "local-derivations-rejected",
            ({ columnId, detail, path }) =>
              "[pretable] A derivations update was rejected as invalid" +
              (columnId === undefined ? "" : ` on column "${columnId}"`) +
              ` at ${path}: ${detail}. The row model kept its previous ` +
              "derivations, so the values it reports are the ones from before " +
              "this update. Correct the column definition, or drop the change.",
          ),
        );
      }
      /*
       * Only when a transition was actually returned: a REJECTED
       * `setDerivations` returns nothing, and reading `.finished` off
       * `undefined` would throw out of this effect — reintroducing the exact
       * fatality the guard above just removed.
       */
      if (transition !== undefined) {
        void transition.finished.catch(() => undefined);
      }
    }
  });

  useLayoutEffect(() => {
    disposalGeneration.current += 1;
    const mountedGeneration = disposalGeneration.current;
    return () => {
      queueMicrotask(() => {
        if (disposalGeneration.current === mountedGeneration) {
          model.dispose();
        }
      });
    };
  }, [model]);

  return model;
}
