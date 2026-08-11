"use client";

import {
  PretableSurface,
  type PastePayload,
  type PretableSortEntry,
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
import { applySort } from "./heroGrid/sort";
import type { PositionRow } from "./heroGrid/types";
import styles from "./heroGrid/heroGrid.module.css";

const FALLBACK_VIEWPORT_HEIGHT = 520;
/** How long the paste summary stays up before clearing itself. */
const PASTE_SUMMARY_MS = 5000;

export function HeroGrid() {
  const { ratePerSec, isPlaying } = useControlState();
  const [rows, setRows] = useState<PositionRow[]>([]);
  const [userSort, setUserSort] = useState<PretableSortEntry[]>([]);
  const replayRef = useRef<ReturnType<typeof createPortfolioReplay> | null>(
    null,
  );

  // Live rows ref — lets columns factory read current rows without being in its deps
  const rowsRef = useRef<PositionRow[]>([]);
  useEffect(() => {
    rowsRef.current = rows;
  }, [rows]);
  const sortedRowsRef = useRef<PositionRow[]>([]);

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
    }),
  );

  const sortedRows = useMemo(() => applySort(rows, userSort), [rows, userSort]);
  useEffect(() => {
    sortedRowsRef.current = sortedRows;
  }, [sortedRows]);

  // Selection / copy state (filtering is uncontrolled — the built-in header
  // funnel menus own it)
  const [selection, setSelection] = useState<SelectionSummary | null>(null);
  const [copied, setCopied] = useState(false);
  const [pasteSummary, setPasteSummary] = useState<PasteSummary | null>(null);
  const pasteSummaryTimerRef = useRef<number | null>(null);
  const editedQtyByIdRef = useRef<Map<string, number>>(new Map());

  const surfaceRef = useRef<HTMLDivElement>(null);
  const [viewportHeight, setViewportHeight] = useState(
    FALLBACK_VIEWPORT_HEIGHT,
  );
  useLayoutEffect(() => {
    const el = surfaceRef.current;
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
        batcher.add(next.filter((row) => !previousIds.has(row.id)));
        batcher.update(
          next
            .filter((row) => previousIds.has(row.id))
            .map((row) => ({ id: row.id, changes: row })),
        );
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
      for (const change of changes) {
        if (change.columnId !== "qty") continue;
        const qty = change.changes.qty;
        if (qty === undefined) continue;
        await new Promise<void>((r) => setTimeout(r, 700)); // simulated order submission (status = saving)
        if (isDeskRejected(change.rowId, qty)) {
          throw new Error("Rejected by trading desk");
        }
        editedQtyByIdRef.current.set(change.rowId, qty);
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

  // onSelectionChange → summarize into row/col counts
  const handleSelectionChange = useCallback(
    (next: PretableSelectionState) => {
      const colOrder = columns.map((c) => c.id);
      const rowOrder = sortedRowsRef.current.map((r) => r.id);
      setSelection(summarizeSelection(next, colOrder, rowOrder));
    },
    [columns],
  );

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
          <div className={styles.heroSurface} ref={surfaceRef}>
            <PretableSurface
              ariaLabel="Live portfolio positions"
              beforeRowChange={handleBeforeRowChange}
              columns={columns}
              copyWithHeaders
              model={rowModel}
              onPaste={handlePaste}
              onSelectionChange={handleSelectionChange}
              onSortChange={(entries) => setUserSort(entries)}
              rowSelectionColumn={{ enabled: true, headerCheckbox: true }}
              viewportHeight={viewportHeight}
            />
            <p className={styles.legend}>
              double-click to edit · drag to select · ⌘C copy · ⌘V paste into
              Qty · funnel to filter
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
