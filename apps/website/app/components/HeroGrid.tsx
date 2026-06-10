"use client";

import { PretableSurface } from "@pretable/react";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";

import { useControlState } from "./heroGrid/controlState";
import { positionColumns } from "./heroGrid/positionColumns";
import { PORTFOLIO_RECORDING } from "./heroGrid/recordings/portfolio";
import { createPortfolioReplay } from "./heroGrid/replay-engine";
import { PortfolioSummary } from "./heroGrid/PortfolioSummary";
import { applySort, type ColumnId, type SortState } from "./heroGrid/sort";
import type { PositionRow } from "./heroGrid/types";
import styles from "./heroGrid/heroGrid.module.css";

const FALLBACK_VIEWPORT_HEIGHT = 520;

export function HeroGrid() {
  const { ratePerSec, isPlaying } = useControlState();
  const [rows, setRows] = useState<PositionRow[]>([]);
  const [userSort, setUserSort] = useState<SortState | null>(null);
  const replayRef = useRef<ReturnType<typeof createPortfolioReplay> | null>(null);

  const sortedRows = useMemo(() => applySort(rows, userSort), [rows, userSort]);

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
    if (reduce) return;

    const replay = createPortfolioReplay({
      recording: PORTFOLIO_RECORDING,
      ratePerSec,
      isPlaying,
      onTransaction: (tx) => {
        setRows((prev) => {
          let next = prev;
          if (tx.add) next = [...next, ...tx.add];
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
              return merged;
            });
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

  return (
    <section className={`hero ${styles.heroBackdrop}`}>
      <div className={styles.heroBezel} data-testid="hero-bezel">
        <div className={styles.heroSplit}>
          <div className={styles.heroSurface} ref={surfaceRef}>
            <PretableSurface<PositionRow>
              ariaLabel="Live portfolio positions"
              columns={positionColumns}
              getRowId={(row) => row.id}
              state={userSort ? { sort: userSort } : null}
              onSortChange={(next) => {
                if (next === null) { setUserSort(null); return; }
                setUserSort({ columnId: next.columnId as ColumnId, direction: next.direction });
              }}
              rowSelectionColumn={{ enabled: true, headerCheckbox: true }}
              rows={sortedRows}
              viewportHeight={viewportHeight}
            />
          </div>
          <div className={styles.heroSidebar}>
            <PortfolioSummary rows={rows} />
          </div>
        </div>
      </div>
    </section>
  );
}
