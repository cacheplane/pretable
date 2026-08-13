"use client";

import {
  PretableSurface,
  type PastePayload,
  type PretableSurfaceGrid,
} from "@pretable/react";
import { createLocalRowModel } from "@pretable/core";
import { createBatcher } from "@pretable/stream-adapter";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { PretableSelectionState } from "@pretable/core";

import { useControlState } from "./heroGrid/controlState";
import { makePositionColumns } from "./heroGrid/positionColumns";
import { withDerivedWeights } from "./heroGrid/positions-math";
import {
  summarizeSelection,
  type SelectionSummary,
} from "./heroGrid/selection";
import { isDeskRejected } from "./heroGrid/qty-edit";
import { planQtyPaste, type PasteSummary } from "./heroGrid/qty-paste";
import { PORTFOLIO_RECORDING } from "./heroGrid/recordings/portfolio";
import { createPortfolioReplay } from "./heroGrid/replay-engine";
import { PortfolioSummary } from "./heroGrid/PortfolioSummary";
import { startingPositions } from "./heroGrid/roster";
import type { PositionRow } from "./heroGrid/types";
import styles from "./heroGrid/heroGrid.module.css";

type HeroSurfaceGrid = PretableSurfaceGrid<
  PositionRow,
  string,
  ReturnType<typeof makePositionColumns>
>;

const FALLBACK_VIEWPORT_HEIGHT = 520;
/** How long the paste summary stays up before clearing itself. */
const PASTE_SUMMARY_MS = 5000;

export function HeroGrid() {
  const { ratePerSec, isPlaying } = useControlState();
  const [rows, setRows] = useState<PositionRow[]>([]);
  const replayRef = useRef<ReturnType<typeof createPortfolioReplay> | null>(
    null,
  );
  const gridRef = useRef<HeroSurfaceGrid | null>(null);

  // Live rows ref — lets columns factory read current rows without being in its deps
  const rowsRef = useRef<PositionRow[]>([]);
  useEffect(() => {
    rowsRef.current = rows;
  }, [rows]);

  // Stable columns — created once so the grid instance is never recreated under streaming.
  // The getRows closure captures the ref *object* (not .current) so it always reads the
  // latest rows without being in the deps array. Block-disable (not -next-line) so the
  // directive survives Prettier reflowing the useMemo across lines.
  /* eslint-disable react-hooks/refs -- intentional: closure reads ref.current lazily (not during render) */
  const columns = useMemo(
    () => makePositionColumns({ getRows: () => rowsRef.current }),
    [],
  ); // empty deps — created once on purpose
  /* eslint-enable react-hooks/refs */
  const [rowModel] = useState(() =>
    createLocalRowModel({
      rows: [] as PositionRow[],
      columns,
      getRowId: (row: PositionRow) => row.id,
      // Largest positions first, and the ENGINE owns it.
      //
      // The hero used to rank a local copy of the rows and hand that array to
      // the grid. When it moved to the `model` prop the ranking stopped being
      // rendered — the book drew in arrival order and never re-ranked, so the
      // weights ran 16.4, 9.7, 8.2, 5, 4.3, 7 down the page — while the local
      // sort kept running, feeding nothing but a selection summary it then made
      // wrong. One order, owned by one thing, is the point.
      //
      // Every tick recomputes every weight (NAV moves), so the book re-ranks
      // live and a position that overtakes its neighbour visibly swaps with it.
      // That motion is intended: it is a portfolio blotter. A header click
      // replaces this sort, exactly as it replaces any other.
      query: {
        filters: [],
        sort: [{ columnId: "weight", direction: "desc" }],
        rowGroups: [],
      },
    }),
  );

  // Selection / copy state (filtering is uncontrolled — the built-in header
  // funnel menus own it)
  const [selection, setSelection] = useState<SelectionSummary | null>(null);
  const [copied, setCopied] = useState(false);
  const [pasteSummary, setPasteSummary] = useState<PasteSummary | null>(null);
  const pasteSummaryTimerRef = useRef<number | null>(null);
  const editedQtyByIdRef = useRef<Map<string, number>>(new Map());

  // Measured on `.heroGridPane` — the box the GRID gets — not on
  // `.heroSurface`, which also has to hold the affordance legend beneath it.
  // `viewportHeight` pins the grid's height exactly, so handing it the surface's
  // height left no room for the legend and pushed it past the bezel, which is
  // `overflow: hidden`. The pane is `flex: 1 1 0` under a `flex: 0 0 auto`
  // legend, so what we measure here is already net of the legend and cannot be
  // grown by the grid we size from it.
  const gridPaneRef = useRef<HTMLDivElement>(null);
  const [viewportHeight, setViewportHeight] = useState(
    FALLBACK_VIEWPORT_HEIGHT,
  );
  useLayoutEffect(() => {
    const el = gridPaneRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const measure = () => {
      const next = Math.max(
        FALLBACK_VIEWPORT_HEIGHT,
        Math.round(el.clientHeight),
      );
      setViewportHeight((prev) => (prev === next ? prev : next));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const reduce =
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
    if (reduce) {
      // No streaming for reduced-motion users — show a settled snapshot of the
      // book so the hero isn't blank. One-time seed: it can't be a lazy
      // useState initializer because the media query is client-only and would
      // hydration-mismatch the server's empty render.
      const settled = withDerivedWeights(startingPositions());
      rowsRef.current = settled;
      // eslint-disable-next-line react-hooks/set-state-in-effect -- one-shot snapshot, runs once then returns
      setRows(settled);
      rowModel.applyTransaction({ add: settled });
      return;
    }

    const batcher = createBatcher(rowModel);

    const replay = createPortfolioReplay({
      recording: PORTFOLIO_RECORDING,
      ratePerSec,
      isPlaying,
      onTransaction: (tx) => {
        const previous = rowsRef.current;
        let next = previous;
        if (tx.add) {
          next = [...next, ...tx.add];
          next = withDerivedWeights(next);
        }
        if (tx.update) {
          const byId = new Map<string, Partial<PositionRow>>();
          for (const p of tx.update) {
            const id = (p as { id?: string }).id;
            if (typeof id !== "string") continue;
            byId.set(id, { ...byId.get(id), ...p });
          }
          next = next.map((row) => {
            const patch = byId.get(row.id);
            if (!patch) return row;
            const merged: PositionRow = { ...row, ...patch };
            // Compute flash direction + bump tickSeq when price changes.
            if (typeof patch.last === "number" && patch.last !== row.last) {
              merged.lastDir = patch.last > row.last ? "up" : "down";
              merged.tickSeq = (row.tickSeq ?? 0) + 1;
            }
            // Apply edited qty override so user changes survive streaming ticks
            const editedQty = editedQtyByIdRef.current.get(row.id);
            if (editedQty !== undefined) {
              merged.qty = editedQty;
              merged.mktValue = Math.round(editedQty * merged.last);
            }
            return merged;
          });
          next = withDerivedWeights(next);
        }
        rowsRef.current = next;
        setRows(next);
        const previousIds = new Set(previous.map((row) => row.id));
        const added = next.filter((row) => !previousIds.has(row.id));
        const updated = next
          .filter((row) => previousIds.has(row.id))
          .map((row) => ({ id: row.id, changes: row }));
        if (added.length > 0) {
          // Element-stream rows may all parse before the next animation frame.
          // Keep each addition and the resulting portfolio-weight updates in
          // one valid row-model transaction instead of allowing a later add to
          // turn a still-buffered row into both an add and an update.
          batcher.flush();
          rowModel.applyTransaction({ add: added, update: updated });
        } else {
          batcher.update(updated);
        }
      },
    });
    replayRef.current = replay;
    return () => {
      replay.dispose();
      batcher.dispose();
      replayRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mount-once; rate/playing go through separate effects
  }, []);

  useEffect(() => {
    replayRef.current?.setRate(ratePerSec);
  }, [ratePerSec]);
  useEffect(() => {
    replayRef.current?.setPlaying(isPlaying);
  }, [isPlaying]);

  useEffect(() => () => rowModel.dispose(), [rowModel]);

  const handleBeforeRowChange = useCallback(
    async (
      changes: readonly {
        readonly rowId: string;
        readonly columnId: string;
        readonly changes: Partial<PositionRow>;
      }[],
    ) => {
      const acceptedQty: Array<readonly [rowId: string, qty: number]> = [];
      for (const change of changes) {
        if (change.columnId !== "qty") continue;
        const qty = change.changes.qty;
        if (qty === undefined) continue;
        await new Promise<void>((r) => setTimeout(r, 700)); // simulated order submission (status = saving)
        if (isDeskRejected(change.rowId, qty)) {
          throw new Error("Rejected by trading desk");
        }
        acceptedQty.push([change.rowId, qty]);
      }
      // The surface applies the accepted batch as one row-model transaction.
      // Keep the streaming override map just as atomic: a later rejection must
      // not leave earlier rows from the same paste partially accepted.
      for (const [rowId, qty] of acceptedQty) {
        editedQtyByIdRef.current.set(rowId, qty);
      }
      const next = withDerivedWeights(
        rowsRef.current.map((row) => {
          const change = changes.find((entry) => entry.rowId === row.id);
          return change === undefined ? row : { ...row, ...change.changes };
        }),
      );
      rowsRef.current = next;
      setRows(next);
    },
    [],
  );

  // onPaste reports one completed clipboard batch. `beforeRowChange` owns the
  // accepted row patches; this callback uses the complete payload (including
  // rejected cells) only for the transient sidebar summary.
  const handlePaste = useCallback((payload: PastePayload<PositionRow>) => {
    const { summary } = planQtyPaste(payload);
    // Transient, like the "Copied ✓" flash — but held longer, since the line
    // carries counts worth reading. A second paste restarts the clock.
    setPasteSummary(summary);
    if (pasteSummaryTimerRef.current !== null) {
      window.clearTimeout(pasteSummaryTimerRef.current);
    }
    pasteSummaryTimerRef.current = window.setTimeout(() => {
      pasteSummaryTimerRef.current = null;
      setPasteSummary(null);
    }, PASTE_SUMMARY_MS);
  }, []);

  useEffect(
    () => () => {
      if (pasteSummaryTimerRef.current !== null) {
        window.clearTimeout(pasteSummaryTimerRef.current);
      }
    },
    [],
  );

  // onSelectionChange → summarize into row/col counts.
  //
  // Both orders come off the engine, never off this component's `columns` or
  // its rows: a range is a pair of boundary ids with everything between them
  // implied, so it resolves only against the model the grid is DRAWING, and the
  // two diverge the moment the grid draws something the props do not carry or
  // stops drawing something they do. The synthetic row-select column is drawn
  // and is in no prop; grouping adds the derived group column and removes the
  // grouped one; a header funnel filters rows out of the drawn set entirely.
  //
  // `columnLayout` is that drawn column list, and `range(0, visibleRowCount)`
  // the drawn row list — group headers included, because they are inside the
  // rectangle ⌘C copies and the label speaks for that rectangle.
  const handleSelectionChange = useCallback((next: PretableSelectionState) => {
    const grid = gridRef.current;
    if (grid === null) return;
    const { snapshot } = grid.rowModel.getState();
    setSelection(
      summarizeSelection(
        next,
        grid.getState().columnLayout.map((column) => column.id),
        snapshot
          .range(0, snapshot.visibleRowCount)
          .map((row) => (row.kind === "data" ? row.rowId : row.groupId)),
      ),
    );
  }, []);

  // Copy feedback — transient "Copied ✓" toast when ⌘/Ctrl+C fires with a selection
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Ignore ⌘C while typing in an input (e.g. the filter menu's value
      // fields) — that copies text, not grid cells, so it shouldn't flash the
      // grid copy toast.
      const inInput =
        document.activeElement instanceof HTMLInputElement ||
        document.activeElement instanceof HTMLTextAreaElement;
      if (
        (e.metaKey || e.ctrlKey) &&
        (e.key === "c" || e.key === "C") &&
        selection &&
        !inInput
      ) {
        setCopied(true);
        window.setTimeout(() => setCopied(false), 1500);
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [selection]);

  return (
    <section className={`hero ${styles.heroBackdrop}`}>
      <div className={styles.heroBezel} data-testid="hero-bezel">
        <div className={styles.heroSplit}>
          <div className={styles.heroSurface}>
            <div className={styles.heroGridPane} ref={gridPaneRef}>
              <PretableSurface
                ariaLabel="Live portfolio positions"
                beforeRowChange={handleBeforeRowChange}
                columns={columns}
                copyWithHeaders
                // Enabled but EMPTY on arrival. First paint stays the flat
                // streaming book — the hero's actual job — and the panel's own
                // "Drag a column here to group by it" invites the gesture, so a
                // visitor discovers grouping by performing it. The strip consumes
                // from `viewportHeight` rather than adding to it, so the bezel
                // below is bit-for-bit where it was.
                groupPanel={{ enabled: true }}
                groupColumn={{ header: "Group" }}
                model={rowModel}
                onGridReady={(grid) => {
                  gridRef.current = grid;
                }}
                onPaste={handlePaste}
                onSelectionChange={handleSelectionChange}
                rowSelectionColumn={{ enabled: true, headerCheckbox: true }}
                viewportHeight={viewportHeight}
              />
            </div>
            <p className={styles.legend} data-testid="hero-legend">
              double-click to edit · drag to select · ⌘C copy · ⌘V paste into
              Qty · funnel to filter · drag a header up to group
            </p>
          </div>
          <div className={styles.heroSidebar}>
            <PortfolioSummary
              rows={rows}
              selection={selection}
              copied={copied}
              paste={pasteSummary}
            />
          </div>
        </div>
      </div>
    </section>
  );
}
