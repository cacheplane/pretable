import {
  createLocalRowModel,
  type CreateLocalRowModelOptions,
  type CreateLocalRowModelWithDefaultIdOptions,
  type PretableDerivationsFor,
  type PretableRowId,
  type PretableRowModel,
} from "@pretable/core";
import { useLayoutEffect, useRef, useState } from "react";

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
      lastRows.current = options.rows;
      model.setRows(options.rows as readonly object[]);
    }
    const derivations = options.derivations ?? options.columns;
    if (lastDerivations.current !== derivations) {
      lastDerivations.current = derivations;
      const transition = model.setDerivations(derivations as never);
      void transition.finished.catch(() => undefined);
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
