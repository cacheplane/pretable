import type {
  PretableDistinctValueQuery,
  PretableProcessingOptions,
} from "@pretable/core";
import type { ReactNode } from "react";
import {
  Fragment,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";

import {
  asSurfaceNodes,
  isSurfaceFilterGroup,
  type SurfaceFilterGroup,
  type SurfaceFilterLeaf,
  type SurfaceFilterNode,
} from "../../filter-tree";
import {
  defaultDraft,
  fromColumnFilter,
  operatorValueShape,
  toColumnFilter,
  type FilterDraft,
} from "../../filter-menu/filter-operators";
import {
  FilterRow,
  type FilterRowColumn,
  type FilterRowLeaf,
} from "./FilterRow";
import { JoinControl } from "./JoinControl";
import {
  depthOf,
  insertNode,
  removeNode,
  replaceNode,
  resolveNode,
  setGroupOp,
  type FilterPath,
} from "./filter-paths";

/** The header menu's dwell, because it is the same gesture in a second place. */
const DEBOUNCE_MS = 200;

/**
 * The engine's own bound on filter nesting, restated because
 * `compiled-query.ts` keeps it module-private (its comment argues that the
 * bound must live in exactly one place — the place that ENFORCES it). Root
 * nodes are depth 0, and a node deeper than this makes `compileQuery` throw
 * `invalid-query` out of `setQuery`, which no consumer catches.
 *
 * Restating a private constant is a real risk, and it is pinned in the suite:
 * the refusal test builds a tree at exactly this depth through the ENGINE, so
 * a change to the engine's bound fails that test rather than quietly leaving
 * this section one level out.
 */
const MAX_FILTER_TREE_DEPTH = 64;

const DEPTH_REFUSAL = `The filter tree cannot nest deeper than ${MAX_FILTER_TREE_DEPTH} levels.`;

/**
 * The slice of the row-model handle the filters section drives. Structural,
 * exactly as `ColumnsSectionGrid` is: the surface hands in a handle that is
 * stable for the model's lifetime, and this type documents that the section
 * reads LIVE query state through it rather than closing over a snapshot.
 */
export interface FiltersSectionGrid {
  readonly subscribe: (listener: () => void) => () => void;
  readonly getState: () => {
    readonly snapshot: {
      readonly query: { readonly filters: readonly unknown[] };
    };
  };
}

export interface FiltersSectionProps {
  readonly grid: FiltersSectionGrid;
  /** The columns a leaf may filter on, in the order the picker offers them. */
  readonly columns: readonly FilterRowColumn[];
  /**
   * The surface's query write, narrowed to the one axis this section owns.
   * Every other axis is re-submitted by the surface exactly as the model holds
   * it, so the section never has to know what sort or grouping are.
   */
  readonly setFilters: (filters: readonly SurfaceFilterNode[]) => void;
  /**
   * The surface's ASYNC distinct-value loader. The row's reader is
   * synchronous, so the section owns the load and hands down a reader over
   * what it already holds — see the note on the component.
   */
  readonly loadDistinctValues?: (
    columnId: string,
  ) => PretableDistinctValueQuery<string>;
  /** Passed through to the rows for the incomplete-universe warning. */
  readonly processing?: PretableProcessingOptions;
}

/** What one row is currently showing, which is not always what the tree holds. */
interface RowDraft {
  readonly columnId: string;
  readonly draft: FilterDraft;
}

/**
 * A write the section has decided on but may not have sent yet.
 *
 * `expectColumnId` is the column the addressed node held when the edit
 * STARTED, not the one being written: a column change writes a different
 * column to the same position, and comparing against the new one would abort
 * every column change there is.
 */
interface PendingWrite {
  readonly path: FilterPath;
  readonly expectColumnId: string;
  readonly leaf: FilterRowLeaf;
}

const pathKey = (path: FilterPath) => path.join(".");

/** A node that constrains nothing — see the placeholder note on the component. */
const inertNode = (): SurfaceFilterGroup => ({ op: "and", children: [] });

/**
 * The tool panel's filters section: the engine's AND/OR tree, editable in
 * place — rows for leaves, an indent rail per group, the run's connective
 * between rows, and an add pair under every run.
 *
 * ## It is a projection of engine state, not a draft store
 *
 * The section subscribes to `query.filters` itself, through the stable handle
 * it is given, and writes through the surface's query path. It does NOT
 * receive the tree as a prop: a descriptor's `render` closure is memoized on
 * stable handles, so a tree baked in there would be stale the moment anything
 * else committed a query (the trap the surface's `toolPanelSections` memo
 * records at the point of temptation).
 *
 * ## Nodes are addressed by POSITION
 *
 * Filter nodes have no ids and `compileQuery` re-allocates every one of them
 * on every commit, so a path is the only address that survives a round trip.
 * React keys are the path joined; every write resolves its path against the
 * LIVE tree and refuses when it no longer addresses what it expected
 * (`filter-paths` owns that arithmetic and its stale-path contract).
 *
 * ## The half-built condition, and why an unfinished row is a GROUP
 *
 * The engine will not hold an unfinished condition: a leaf whose operand is
 * missing fails `setQuery` with "filter is missing its operand" (asserted in
 * the suite, because every decision here rests on it). A builder must
 * nonetheless let a user open a row and think about it.
 *
 * So a row whose draft is incomplete occupies its position as an EMPTY GROUP,
 * which is the one node the engine accepts everywhere and which evaluates
 * TRUE under both operators — SP2a's rule, adopted for exactly the case it
 * was written for. The section remembers the draft locally and renders the
 * position as the row the user is building; the engine sees a node that
 * constrains nothing. `+ filter` and `+ group` therefore write the SAME node,
 * and the only difference between them is whether a draft is attached: to the
 * engine, an unfinished condition and an empty group are the same statement.
 *
 * Two consequences, both deliberate. A row abandoned unfinished persists as
 * an empty group and reads as an empty rail when the pane is reopened — it is
 * inert and removable, and the alternative (leaving the last complete filter
 * applied while the row shows something else) filters the grid by something
 * the panel does not display. And an incomplete draft NEVER moves the grid,
 * which is what makes live commits safe without an Apply button.
 *
 * ## Local state is drafts, and only drafts
 *
 * The draft map holds what each touched row is showing. It is dropped on
 * unmount — the tree is the record, and a write that fires after the pane
 * closes has no row left to reconcile with. It is also dropped on a REMOVE,
 * which is the only write here that renumbers siblings and therefore the only
 * one that can leave a draft addressing a row the user was not editing.
 *
 * A pending debounced write is deliberately NOT cancelled by that removal:
 * the re-resolution at fire time is what must protect the tree, and cancelling
 * would hide whether it does.
 *
 * ## `distinctValues` is a sync reader over an async load
 *
 * The rows read choices synchronously; the surface's loader answers a
 * `PretableDistinctValueQuery`. The section holds what has loaded and hands
 * down a reader over it, so a set-shaped row on an enum column with no
 * declared options renders "No values to choose from" until the load lands.
 * The row cannot tell that state from a column that genuinely has none, and
 * this section does not try to: a spinner would need the row to render
 * something other than the checklist, which is a control change, not a label.
 */
export function FiltersSection({
  grid,
  columns,
  setFilters,
  loadDistinctValues,
  processing,
}: FiltersSectionProps) {
  // The section's OWN subscription, and the SNAPSHOT slice rather than the
  // state: `filters` changes identity only when a query commits, so every
  // other publish bails in useSyncExternalStore's equality check instead of
  // repainting the pane.
  const readFilters = useCallback(
    () => grid.getState().snapshot.query.filters,
    [grid],
  );
  const filters = useSyncExternalStore(
    grid.subscribe,
    readFilters,
    readFilters,
  );
  const nodes = useMemo(() => asSurfaceNodes(filters), [filters]);

  const [drafts, setDrafts] = useState<ReadonlyMap<string, RowDraft>>(
    () => new Map(),
  );
  const [distinct, setDistinct] = useState<ReadonlyMap<string, string[]>>(
    () => new Map(),
  );

  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingRef = useRef<PendingWrite | null>(null);

  const columnFor = useCallback(
    (columnId: string) => columns.find((column) => column.id === columnId),
    [columns],
  );
  const typeFor = useCallback(
    (columnId: string) => columnFor(columnId)?.type ?? "text",
    [columnFor],
  );

  /**
   * The LIVE tree, read at write time. The render-time array is what the user
   * pointed at, but a write must be built on what the engine holds now — and
   * when the two disagree it is precisely because the path went stale, which
   * every `filter-paths` operation refuses on.
   */
  const currentNodes = useCallback(
    () => asSurfaceNodes(grid.getState().snapshot.query.filters),
    [grid],
  );

  const commit = useCallback(
    (
      next: readonly SurfaceFilterNode[],
      previous: readonly SurfaceFilterNode[],
    ) => {
      // `filter-paths` returns its input BY REFERENCE when a path does not
      // address what the operation needs, so this is the module's own abort
      // signal — no query, no repaint.
      if (next === previous) return;
      setFilters(next);
    },
    [setFilters],
  );

  /**
   * Send one row's draft to the engine, or refuse.
   *
   * The refusal is the point of this function: a debounced operand can arrive
   * after its row was removed and every later sibling renumbered, and writing
   * anyway would edit a filter the user was not looking at.
   */
  const applyWrite = useCallback(
    (write: PendingWrite) => {
      const previous = currentNodes();
      const target = resolveNode(previous, write.path);
      if (target === undefined) return;
      if (isSurfaceFilterGroup(target)) {
        // An unfinished row occupies its slot as an empty group, so a group is
        // a legitimate target — but only an empty one. A group with children
        // is somebody else's, and the position was inherited, not kept.
        if (target.children.length > 0) return;
      } else if (target.columnId !== write.expectColumnId) {
        return;
      }
      const filter = toColumnFilter(
        typeFor(write.leaf.columnId),
        write.leaf.draft,
      );
      // Still unfinished, and the position already holds the inert node that
      // says so. Writing a second one would recompile the whole query — every
      // node re-captured and re-frozen — to produce the tree the engine has.
      if (filter === null && isSurfaceFilterGroup(target)) return;
      const node: SurfaceFilterNode =
        filter === null
          ? inertNode()
          : ({
              columnId: write.leaf.columnId,
              operator: filter.operator,
              ...(filter.value === undefined ? {} : { value: filter.value }),
            } as SurfaceFilterLeaf);
      commit(replaceNode(previous, write.path, node), previous);
    },
    [commit, currentNodes, typeFor],
  );

  const cancelTimer = useCallback(() => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    pendingRef.current = null;
  }, []);

  const schedule = useCallback(
    (write: PendingWrite) => {
      const inFlight = pendingRef.current;
      // Typing moved to another row: the one being left commits now rather
      // than waiting behind a timer it no longer owns.
      if (inFlight !== null && pathKey(inFlight.path) !== pathKey(write.path)) {
        applyWrite(inFlight);
      }
      if (timerRef.current !== null) clearTimeout(timerRef.current);
      pendingRef.current = write;
      timerRef.current = setTimeout(() => {
        timerRef.current = null;
        const due = pendingRef.current;
        pendingRef.current = null;
        if (due !== null) applyWrite(due);
      }, DEBOUNCE_MS);
    },
    [applyWrite],
  );

  // Drop the timer on unmount. Nothing is flushed: the pane closing takes the
  // rows with it, and a write landing afterwards would be reconciled against a
  // tree the user can no longer see.
  useEffect(
    () => () => {
      if (timerRef.current !== null) clearTimeout(timerRef.current);
      timerRef.current = null;
      pendingRef.current = null;
    },
    [],
  );

  const onRowChange = useCallback(
    (path: FilterPath, shown: RowDraft, next: FilterRowLeaf) => {
      setDrafts((current) => new Map(current).set(pathKey(path), next));
      const write: PendingWrite = {
        path,
        expectColumnId: shown.columnId,
        leaf: next,
      };
      const shape = operatorValueShape(next.draft.operator);
      const typing =
        next.columnId === shown.columnId &&
        next.draft.operator === shown.draft.operator &&
        (shape === "single" || shape === "range");
      // Everything discrete — the column, the operator, a checkbox — applies
      // at once; only a value the user is still typing waits.
      if (typing) schedule(write);
      else {
        cancelTimer();
        applyWrite(write);
      }
    },
    [applyWrite, cancelTimer, schedule],
  );

  const onRowRemove = useCallback(
    (path: FilterPath) => {
      const previous = currentNodes();
      // The one write that renumbers siblings, so it is the one write after
      // which no buffered draft can be trusted to address the row it was typed
      // into. The pending TIMER stays: its own re-resolution is what must
      // decline, and short-circuiting that here would leave the rule untested.
      setDrafts(new Map());
      commit(removeNode(previous, path), previous);
    },
    [commit, currentNodes],
  );

  const readDistinctValues = useCallback(
    (columnId: string) => distinct.get(columnId) ?? [],
    [distinct],
  );

  // Which columns are rendering a checklist they cannot fill from their own
  // `options`. Derived from the tree the drafts are layered over, so a row
  // that has just switched to `isAnyOf` is included and one that has switched
  // away is not.
  const wanted = useMemo(() => {
    const ids = new Set<string>();
    const walk = (children: readonly SurfaceFilterNode[], path: FilterPath) => {
      children.forEach((node, index) => {
        const here = [...path, index];
        const draft = drafts.get(pathKey(here));
        if (isSurfaceFilterGroup(node) && draft === undefined) {
          walk(node.children, here);
          return;
        }
        // The row as it READS: its draft when it has one, the tree's leaf
        // otherwise. A group with no draft has already been walked into above.
        const shown =
          draft ??
          (isSurfaceFilterGroup(node)
            ? undefined
            : { columnId: node.columnId, draft: { operator: node.operator } });
        if (shown === undefined) return;
        if (operatorValueShape(shown.draft.operator) !== "set") return;
        const column = columnFor(shown.columnId);
        if (column === undefined || column.type !== "enum") return;
        if ((column.options?.length ?? 0) > 0) return;
        ids.add(column.id);
      });
    };
    walk(nodes, []);
    return [...ids].sort();
  }, [columnFor, drafts, nodes]);
  const wantedKey = wanted.join(" ");

  // The load the row's synchronous reader cannot do for itself. Keyed on the
  // set of columns that want choices, so scrolling a value or flipping an
  // operator does not re-issue a query that already answered.
  const loadedRef = useRef(distinct);
  useEffect(() => {
    loadedRef.current = distinct;
  }, [distinct]);
  useEffect(() => {
    if (loadDistinctValues === undefined || wantedKey === "") return;
    let active = true;
    const queries = wantedKey
      .split(" ")
      .filter((columnId) => !loadedRef.current.has(columnId))
      .map((columnId) => {
        const query = loadDistinctValues(columnId);
        void query.finished.then(
          (result) => {
            if (!active) return;
            setDistinct((current) =>
              new Map(current).set(
                columnId,
                result.values.map((entry) => String(entry.value)),
              ),
            );
          },
          () => {
            // A failed load is indistinguishable from an empty column to the
            // row, which is the seam's documented cost. Recording an empty
            // list at least stops the load from being re-issued on every
            // keystroke in the same pane.
            if (!active) return;
            setDistinct((current) => new Map(current).set(columnId, []));
          },
        );
        return query;
      });
    return () => {
      active = false;
      for (const query of queries) query.cancel();
    };
  }, [loadDistinctValues, wantedKey]);

  const addActions = (groupPath: FilterPath, count: number) => {
    // The depth the NEW node would land at, read from the group being added
    // INTO: `depthOf([])` is -1, so a root add lands at 0. The slot path handed
    // to `insertNode` already carries the new node's own segment, which is why
    // there is no second `+ 1` below.
    const landing = depthOf(groupPath) + 1;
    const allowed = landing <= MAX_FILTER_TREE_DEPTH;
    const slot: FilterPath = [...groupPath, count];
    const refusal = allowed ? {} : { disabled: true, title: DEPTH_REFUSAL };
    return (
      <div>
        <button
          type="button"
          data-pretable-filter-add=""
          {...refusal}
          onClick={() => {
            const first = columns[0];
            if (first === undefined) return;
            const previous = currentNodes();
            const next = insertNode(previous, slot, inertNode());
            if (next === previous) return;
            // The row is a draft over an inert node until it has a value —
            // the component note argues why the engine cannot hold it yet.
            setDrafts((current) =>
              new Map(current).set(pathKey(slot), {
                columnId: first.id,
                draft: defaultDraft(
                  first.type ?? "text",
                  first.filterOperators,
                ),
              }),
            );
            setFilters(next);
          }}
        >
          + filter
        </button>
        <button
          type="button"
          data-pretable-filter-add=""
          {...refusal}
          onClick={() => {
            const previous = currentNodes();
            commit(insertNode(previous, slot, inertNode()), previous);
          }}
        >
          + group
        </button>
      </div>
    );
  };

  const renderRun = (
    children: readonly SurfaceFilterNode[],
    groupPath: FilterPath,
    op: SurfaceFilterGroup["op"],
    onJoinChange: ((next: SurfaceFilterGroup["op"]) => void) | undefined,
  ): ReactNode => (
    <>
      {children.map((node, index) => {
        const path = [...groupPath, index];
        const key = pathKey(path);
        // `onChange` is OMITTED for a run whose join cannot be set — the root
        // array is an implicit AND with no `op` field, and a button wired to a
        // no-op would promise a change it cannot make.
        const join = (
          <JoinControl first={index === 0} op={op} onChange={onJoinChange} />
        );
        const draft = drafts.get(key);
        const unfinishedRow =
          draft !== undefined &&
          (!isSurfaceFilterGroup(node) || node.children.length === 0);

        if (isSurfaceFilterGroup(node) && !unfinishedRow) {
          return (
            <Fragment key={key}>
              {join}
              <div data-pretable-filter-rail="">
                {renderRun(node.children, path, node.op, (next) => {
                  const previous = currentNodes();
                  commit(setGroupOp(previous, path, next), previous);
                })}
              </div>
            </Fragment>
          );
        }

        const shown: RowDraft =
          draft ??
          (() => {
            const leaf = node as SurfaceFilterLeaf;
            const column = columnFor(leaf.columnId);
            return {
              columnId: leaf.columnId,
              // `fromColumnFilter`, not a hand-built draft: it is the same
              // conversion the funnel menu seeds from, and it is why an
              // operator a column's `filterOperators` prunes still reaches
              // the row's operator list intact.
              draft: fromColumnFilter(
                column?.type ?? "text",
                {
                  operator: leaf.operator,
                  ...(leaf.value === undefined ? {} : { value: leaf.value }),
                },
                column?.filterOperators,
              ),
            };
          })();

        return (
          <FilterRow
            key={key}
            columns={columns}
            columnId={shown.columnId}
            draft={shown.draft}
            join={join}
            onChange={(next) => onRowChange(path, shown, next)}
            onRemove={() => onRowRemove(path)}
            distinctValues={readDistinctValues}
            processing={processing}
          />
        );
      })}
      {addActions(groupPath, children.length)}
    </>
  );

  return (
    <>
      {nodes.length === 0 ? (
        // Hardcoded English like the rest of the panel — the whole section is
        // a known messages-system gap, tracked as this sub-project's Task 7.
        <div data-pretable-filter-empty="">
          No filters. Every row in the grid is showing.
        </div>
      ) : null}
      {renderRun(nodes, [], "and", undefined)}
    </>
  );
}
