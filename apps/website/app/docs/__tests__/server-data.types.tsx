/**
 * The TypeScript fences in `content/docs/server-data`, transcribed so
 * `tsc --noEmit` compiles them. A documented snippet that does not compile is a
 * documented lie, and MDX is not typechecked.
 *
 * Each `// docs-fence:` marker binds everything up to the next marker to the
 * fence under that heading. The preamble above the first marker is prepended to
 * every region, which is what lets several snippets share one import.
 *
 * `server-data/index.mdx` is deliberately NOT bound here: all three of its
 * fences are JSON — the request and response bodies for `POST /api/docs/rows`,
 * and a grouped `filters` payload — and there is no TypeScript on the page to
 * anchor a region to. Binding it would buy two
 * `UNTRANSCRIBED_FENCES` excuses and nothing else. The route's own shapes are
 * held by the app's typecheck where they are declared.
 */
import {
  PretableSurface,
  resolveDataScope,
  type DataHonestyInput,
  type PretableColumn,
  type PretableDataState,
  type PretableMatchingTotal,
  type PretableQueryFor,
  type PretableQueryOptions as ShippedQueryOptions,
} from "@pretable/react";
import type { ReactElement } from "react";

interface Order {
  id: string;
  customer: string;
  total: number;
}

declare const columns: readonly PretableColumn<Order>[];
declare const rows: readonly Order[];
declare const dataState: PretableDataState;
declare const total: PretableMatchingTotal;
declare function refetch(): void;
declare function RetryStrip(props: {
  message: string;
  onRetry: () => void;
}): ReactElement;
declare function OrderSkeleton(props: { rows: number }): ReactElement;

// docs-fence: server-data/lifecycle.mdx#Replacing the built-in blocks
export const bodyStateSurface = (
  <PretableSurface<Order>
    ariaLabel="Orders"
    columns={columns}
    rows={rows}
    dataState={dataState}
    renderBodyState={({ kind, phase, loadedRowCount }) =>
      kind === "error-strip" ? (
        <RetryStrip
          message={phase === "error" ? "Request failed" : ""}
          onRetry={refetch}
        />
      ) : kind === "loading" ? (
        <OrderSkeleton rows={loadedRowCount} />
      ) : null
    }
    viewportHeight={520}
  />
);

// docs-fence: server-data/query-ownership.mdx#Three ways to own the query
export type PretableQueryOptions<TColumns> =
  /** Controlled: `query` requires its setter, as `value` requires `onChange`. */
  | {
      readonly query: PretableQueryFor<NoInfer<TColumns>>;
      readonly onQueryChange: (
        query: PretableQueryFor<NoInfer<TColumns>>,
      ) => void;
    }
  /** Uncontrolled: the engine owns the query, and MAY report changes. */
  | {
      readonly query?: never;
      readonly onQueryChange?: (
        query: PretableQueryFor<NoInfer<TColumns>>,
      ) => void;
    };

/**
 * This fence is not a usage example — it is the shipped declaration, reprinted.
 * Compiling a copy of a type proves only that the copy is well-formed, so the
 * copy is held to the original: mutually assignable in both directions, which
 * an added arm, a dropped `?`, or a retyped member each break.
 */
type MutuallyAssignable<A, B> = [A] extends [B]
  ? [B] extends [A]
    ? true
    : never
  : never;

export const queryOptionsMatchesTheShippedType: MutuallyAssignable<
  PretableQueryOptions<readonly PretableColumn<Order>[]>,
  ShippedQueryOptions<readonly PretableColumn<Order>[]>
> = true;

// docs-fence: server-data/totals.mdx#Exporting under external authority
const honesty: DataHonestyInput = {
  visibleRowCount: rows.length,
  isGrouped: false,
  loadedRowCount: rows.length,
  matchingTotal: total,
};

export const scope = resolveDataScope(honesty, { filter: "external" });

// docs-fence: server-data/windowing.mdx#The window
export const windowedSurface = (
  <PretableSurface<Order>
    ariaLabel="Orders"
    columns={columns}
    processing={{ filter: "external", sort: "external" }}
    resultMeta={{
      total: { kind: "exact", count: 480 },
      datasetKey: "orders",
      window: { start: 100, hasMore: true },
    }}
    rows={rows}
    // Not in the fence, which shows only the props a window turns on.
    // `viewportHeight` is required on the rows form of the surface, so the
    // snippet needs it here to compile.
    viewportHeight={320}
  />
);
