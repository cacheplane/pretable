"use client";

import { PretableSurface } from "@pretable/react";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { PretableSelectionState } from "@pretable/core";

import { useControlState } from "./heroGrid/controlState";
import { makePositionColumns } from "./heroGrid/positionColumns";
import { withDerivedWeights } from "./heroGrid/positions-math";
import { buildFilters, type FilterState } from "./heroGrid/filters";
import { summarizeSelection, type SelectionSummary } from "./heroGrid/selection";
import { isDeskRejected } from "./heroGrid/qty-edit";
import { PORTFOLIO_RECORDING } from "./heroGrid/recordings/portfolio";
import { createPortfolioReplay } from "./heroGrid/replay-engine";
import { PortfolioSummary } from "./heroGrid/PortfolioSummary";
import { startingPositions } from "./heroGrid/roster";
import { applySort, type ColumnId, type SortState } from "./heroGrid/sort";
import type { PositionRow } from "./heroGrid/types";
import styles from "./heroGrid/heroGrid.module.css";

const FALLBACK_VIEWPORT_HEIGHT = 520;

export function HeroGrid() {
  const { ratePerSec, isPlaying } = useControlState();
  const [rows, setRows] = useState<PositionRow[]>([]);
  const [userSort, setUserSort] = useState<SortState | null>(null);
  const replayRef = useRef<ReturnType<typeof createPortfolioReplay> | null>(null);

  // Live rows ref — lets columns factory read current rows without being in its deps
  const rowsRef = useRef<PositionRow[]>([]);
  useEffect(() => { rowsRef.current = rows; }, [rows]);
  const sortedRowsRef = useRef<PositionRow[]>([]);

  // Stable columns — created once so the grid instance is never recreated under streaming.
  // The getRows closure captures the ref *object* (not .current) so it always reads the
  // latest rows without being in the deps array.
  // eslint-disable-next-line react-hooks/refs -- intentional: closure reads ref.current lazily (not during render)
  const columns = useMemo(() => makePositionColumns({ getRows: () => rowsRef.current }), []); // empty deps — created once on purpose

  const sortedRows = useMemo(() => applySort(rows, userSort), [rows, userSort]);
  useEffect(() => { sortedRowsRef.current = sortedRows; }, [sortedRows]);

  // Filter / selection / copy state
  const [filter, setFilter] = useState<FilterState>({ search: "", sector: "All" });
  const [selection, setSelection] = useState<SelectionSummary | null>(null);
  const [copied, setCopied] = useState(false);
  const editedQtyByIdRef = useRef<Map<string, number>>(new Map());

  // Debounce the search term (~150ms) so we don't re-filter on every keystroke;
  // the sector chip applies immediately. The input stays responsive because the
  // FilterSection input is bound to `filter.search` directly.
  const [appliedSearch, setAppliedSearch] = useState("");
  useEffect(() => {
    const t = window.setTimeout(() => setAppliedSearch(filter.search), 150);
    return () => window.clearTimeout(t);
  }, [filter.search]);
  const filterMap = useMemo(
    () => buildFilters({ search: appliedSearch, sector: filter.sector }),
    [appliedSearch, filter.sector],
  );

  const surfaceRef = useRef<HTMLDivElement>(null);
  const [viewportHeight, setViewportHeight] = useState(FALLBACK_VIEWPORT_HEIGHT);
  useLayoutEffect(() => {
    const el = surfaceRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const measure = () => {
      const next = Math.max(FALLBACK_VIEWPORT_HEIGHT, Math.round(el.clientHeight));
      setViewportHeight((prev) => (prev === next ? prev : next));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
    if (reduce) {
      // No streaming for reduced-motion users — show a settled snapshot of the
      // book so the hero isn't blank. One-time seed: it can't be a lazy
      // useState initializer because the media query is client-only and would
      // hydration-mismatch the server's empty render.
      // eslint-disable-next-line react-hooks/set-state-in-effect -- one-shot snapshot, runs once then returns
      setRows(withDerivedWeights(startingPositions()));
      return;
    }

    const replay = createPortfolioReplay({
      recording: PORTFOLIO_RECORDING,
      ratePerSec,
      isPlaying,
      onTransaction: (tx) => {
        setRows((prev) => {
          let next = prev;
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
          return next;
        });
      },
    });
    replayRef.current = replay;
    return () => { replay.dispose(); replayRef.current = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mount-once; rate/playing go through separate effects
  }, []);

  useEffect(() => { replayRef.current?.setRate(ratePerSec); }, [ratePerSec]);
  useEffect(() => { replayRef.current?.setPlaying(isPlaying); }, [isPlaying]);

  // onCellEdit — simulated order submission with deterministic desk rejection
  const handleCellEdit = useCallback(async ({ rowId, columnId, value }: {
    rowId: string; columnId: string; value: unknown; row: PositionRow;
  }) => {
    if (columnId !== "qty") return;
    const qty = value as number;
    await new Promise<void>((r) => setTimeout(r, 700)); // simulated order submission (status = saving)
    if (isDeskRejected(rowId, qty)) {
      throw new Error("Rejected by trading desk");
    }
    editedQtyByIdRef.current.set(rowId, qty);
    setRows((prev) => withDerivedWeights(prev.map((r) =>
      r.id === rowId ? { ...r, qty, mktValue: Math.round(qty * r.last) } : r,
    )));
  }, []);

  // onSelectionChange → summarize into row/col counts
  const handleSelectionChange = useCallback((next: PretableSelectionState) => {
    const colOrder = columns.map((c) => c.id);
    const rowOrder = sortedRowsRef.current.map((r) => r.id);
    setSelection(summarizeSelection(next, colOrder, rowOrder));
  }, [columns]);

  // Copy feedback — transient "Copied ✓" toast when ⌘/Ctrl+C fires with a selection
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Ignore ⌘C while typing in an input (e.g. the search box) — that copies
      // text, not grid cells, so it shouldn't flash the grid copy toast.
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
            <PretableSurface<PositionRow>
              ariaLabel="Live portfolio positions"
              columns={columns}
              copyWithHeaders
              getRowId={(row) => row.id}
              onCellEdit={handleCellEdit}
              onSelectionChange={handleSelectionChange}
              onSortChange={(next) => {
                if (next === null) { setUserSort(null); return; }
                setUserSort({ columnId: next.columnId as ColumnId, direction: next.direction });
              }}
              rowSelectionColumn={{ enabled: true, headerCheckbox: true }}
              rows={sortedRows}
              state={{ ...(userSort ? { sort: userSort } : {}), filters: filterMap }}
              viewportHeight={viewportHeight}
            />
            <p className={styles.legend}>double-click to edit · drag to select · ⌘C copy</p>
          </div>
          <div className={styles.heroSidebar}>
            <PortfolioSummary
              rows={rows}
              filter={filter}
              onSearch={(search) => setFilter((f) => ({ ...f, search }))}
              onSector={(sector) => setFilter((f) => ({ ...f, sector }))}
              selection={selection}
              copied={copied}
            />
          </div>
        </div>
      </div>
    </section>
  );
}
