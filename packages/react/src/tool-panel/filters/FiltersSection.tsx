import type {
  PretableDistinctValueQuery,
  PretableProcessingOptions,
} from "@pretable/core";
import type { ReactNode } from "react";
import {
  Fragment,
  useCallback,
  useId,
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
  /**
   * The node this row was last rendered FROM — its address anchor, and the
   * only thing that distinguishes it from a sibling that inherits its index.
   *
   * A value, not a reference: `compileQuery` re-captures every node on every
   * commit, so a reference taken before a commit matches nothing after one —
   * which would abort every write that followed any commit, the user's own
   * included. Re-set whenever this row commits, so it always names what the
   * tree holds for this row rather than what the user has typed since.
   */
  readonly anchor: SurfaceFilterNode;
}

/** A write the section has decided on but may not have sent yet. */
interface PendingWrite {
  readonly path: FilterPath;
  /** The row's anchor as of the edit — see {@link RowDraft.anchor}. */
  readonly anchor: SurfaceFilterNode;
  readonly leaf: FilterRowLeaf;
}

const pathKey = (path: FilterPath) => path.join(".");

/** A node that constrains nothing — see the placeholder note on the component. */
const inertNode = (): SurfaceFilterGroup => ({ op: "and", children: [] });

/**
 * Is this the same statement, field for field?
 *
 * The section's substitute for identity, and it has to be a full comparison:
 * two leaves on one column is ordinary usage (`revenue > 10` and
 * `revenue < 90`), so a column-only check would let a debounced operand land
 * on the neighbour that inherited the index. A group only ever matches an
 * EMPTY group — an unfinished row is the only group this section anchors to,
 * and a populated one is somebody else's subtree, not a row.
 *
 * `value` goes through `JSON.stringify` because a filter operand may be an
 * ARRAY — a set selection or a range — and comparing those by `===` would
 * report every re-captured operand as a different one.
 */
function sameNode(a: SurfaceFilterNode, b: SurfaceFilterNode): boolean {
  if (isSurfaceFilterGroup(a) || isSurfaceFilterGroup(b)) {
    return (
      isSurfaceFilterGroup(a) &&
      isSurfaceFilterGroup(b) &&
      a.op === b.op &&
      a.children.length === 0 &&
      b.children.length === 0
    );
  }
  return (
    a.columnId === b.columnId &&
    a.operator === b.operator &&
    JSON.stringify(a.value ?? null) === JSON.stringify(b.value ?? null)
  );
}

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
 * ## Nodes are addressed by POSITION, and a position is not an identity
 *
 * Filter nodes have no ids and `compileQuery` re-captures every one of them on
 * every commit — measured, not assumed: the array, its elements and their
 * nested children all come back as fresh frozen objects, so a reference held
 * across a commit matches nothing. A path is the only address that survives a
 * round trip, and React keys are the path joined.
 *
 * But a path is an address, not an identity: removing a sibling renumbers
 * every later one, and a debounced operand arriving afterwards would land on
 * whichever row inherited the index. So every row also carries an ANCHOR —
 * the node it was last rendered from, compared by VALUE (`sameNode`) because
 * reference identity is gone. A write lands only where the path still
 * resolves to the anchor, and a draft renders only over a node it matches.
 * Two nodes that are equal in every field remain indistinguishable; that
 * residue is inherent to a tree whose nodes carry no identity of their own.
 *
 * ## The half-built condition, and why an unfinished row is a GROUP
 *
 * The engine will not hold a condition whose operator REQUIRES an operand and
 * has none: `setQuery` fails with "filter is missing its operand". The two
 * operators that need no operand — `isEmpty` / `isNotEmpty`, exempted by
 * `validateFilter` and present in every type's set — are accepted, so they
 * are the obvious seed for a fresh row, and they are the wrong one: both are
 * real predicates, and seeding one drops the grid to zero rows on the click
 * that opens the row. Both halves are asserted in the suite, because this
 * choice rests on the accepted case as much as on the refused one.
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
 * The draft map holds what each touched row is showing, keyed by path and
 * guarded by its anchor. It is dropped on unmount — the tree is the record,
 * and a write that fires after the pane closes has no row left to reconcile
 * with. Nothing else clears it: an entry whose row was renumbered away simply
 * stops matching, which is the same rule that stops the write from landing,
 * and it covers the commits this section never sees (the header funnel writes
 * the same tree) as well as its own.
 *
 * A pending debounced write is deliberately NOT cancelled by a removal: the
 * anchor check at fire time is what must protect the tree, and cancelling
 * would hide whether it does.
 *
 * ## A known cost of positional keys
 *
 * The keys ARE the paths, so removing a row remounts every row after it — a
 * focused input below the removal point loses focus and caret. That is
 * inherent to keying by position (a node has nothing else to key by) and is
 * a known cost, not a bug to hunt.
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

  // Document-unique, because a page may hold more than one grid and an `id`
  // that repeated would point every `aria-describedby` at the first one.
  const idPrefix = `${useId()}filter-depth`;

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
   * The refusal is the point of this function. A debounced operand can arrive
   * after its row was removed and every later sibling renumbered, and the path
   * alone cannot tell that apart — so the node the path resolves to must still
   * be the node the edit began on, field for field. Anything else is a row the
   * user was not typing into.
   */
  const applyWrite = useCallback(
    (write: PendingWrite) => {
      const previous = currentNodes();
      const target = resolveNode(previous, write.path);
      if (target === undefined || !sameNode(target, write.anchor)) return;
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
      const next = replaceNode(previous, write.path, node);
      if (next === previous) return;
      setFilters(next);
      // Re-anchor: this row now IS what was just written, and the tree will
      // hold a re-captured copy of it. Without this the next keystroke would
      // measure itself against the value before the commit, and both the draft
      // and the write that follows it would stop matching their own row.
      setDrafts((current) => {
        const key = pathKey(write.path);
        const entry = current.get(key);
        if (entry === undefined) return current;
        return new Map(current).set(key, { ...entry, anchor: node });
      });
    },
    [currentNodes, setFilters, typeFor],
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
      // The anchor rides along unchanged: it names what the TREE holds for this
      // row, and typing has not changed that.
      const entry: RowDraft = { ...next, anchor: shown.anchor };
      setDrafts((current) => new Map(current).set(pathKey(path), entry));
      const write: PendingWrite = { path, anchor: shown.anchor, leaf: next };
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
      // The one write that renumbers siblings — and nothing is cleared or
      // cancelled here. A draft whose row moved stops matching its anchor, so
      // it neither renders nor writes; clearing the map would only hide, for
      // this section's own removals, a rule that must also hold for the
      // commits it never sees.
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
        // Anchored exactly as the render is — an unmatched draft describes no
        // row on screen, so its column wants no choices loaded.
        const held = drafts.get(pathKey(here));
        const draft =
          held !== undefined && sameNode(held.anchor, node) ? held : undefined;
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
    const reasonId = `${idPrefix}-${pathKey(groupPath) || "root"}`;
    // `disabled` because the stylesheet's refusal rule is keyed on `:disabled`
    // and because an inert control must not be operable — but a disabled
    // button is not focusable, so neither a `title` nor a description reliably
    // reaches anyone. The reason is therefore RENDERED, and the buttons point
    // at it; the title is a convenience for the pointer, not the affordance.
    const refusal = allowed
      ? {}
      : {
          disabled: true,
          title: DEPTH_REFUSAL,
          "aria-describedby": reasonId,
        };
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
            const seed = inertNode();
            const next = insertNode(previous, slot, seed);
            if (next === previous) return;
            // The row is a draft over an inert node until it has a value —
            // the component note argues why the engine cannot hold it yet —
            // and `seed` is what anchors it there.
            setDrafts((current) =>
              new Map(current).set(pathKey(slot), {
                columnId: first.id,
                draft: defaultDraft(
                  first.type ?? "text",
                  first.filterOperators,
                ),
                anchor: seed,
              }),
            );
            commit(next, previous);
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
        {allowed ? null : <span id={reasonId}>{DEPTH_REFUSAL}</span>}
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
        // The draft applies only where it still ANCHORS: a path is an address,
        // and after a removal — or a commit this section never saw — the row
        // at this address may be somebody else's. An unmatched draft is inert,
        // not authoritative.
        const held = drafts.get(key);
        const draft =
          held !== undefined && sameNode(held.anchor, node) ? held : undefined;

        if (isSurfaceFilterGroup(node) && draft === undefined) {
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
              anchor: node,
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
