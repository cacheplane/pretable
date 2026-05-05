"use client";

import { PretableSurface } from "@pretable/react";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";

import { useControlState } from "./heroGrid/controlState";
import { raceColumns } from "./heroGrid/raceColumns";
import { RACE_RECORDING } from "./heroGrid/recordings/race";
import { createRaceReplay } from "./heroGrid/replay-engine";
import { Scoreboard } from "./heroGrid/Scoreboard";
import { applySort, type ColumnId, type SortState } from "./heroGrid/sort";
import type { RaceRow } from "./heroGrid/types";
import styles from "./heroGrid/heroGrid.module.css";

const FALLBACK_VIEWPORT_HEIGHT = 520;
const VISIBLE_BUFFER_ROWS = 200;

export function HeroGrid() {
  const { ratePerSec, isPlaying } = useControlState();
  const [rows, setRows] = useState<RaceRow[]>([]);
  const [userSort, setUserSort] = useState<SortState | null>(null);
  const replayRef = useRef<ReturnType<typeof createRaceReplay> | null>(null);

  // Sort layer: when userSort is null, applySort delegates to rankRows (default
  // leaderboard rank). When user clicks a column header, applySort uses the
  // per-column comparator. Insertion order in `rows` is irrelevant for display.
  const sortedRows = useMemo(() => applySort(rows, userSort), [rows, userSort]);

  // Bezel-fill viewport measurement — same pattern as Bucket B.
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

  // Mount-once: create the replay engine. Apply transactions to local rows state.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const reduce =
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
    if (reduce) return;

    const replay = createRaceReplay({
      recording: RACE_RECORDING,
      ratePerSec,
      isPlaying,
      onTransaction: (tx) => {
        setRows((prev) => {
          let next = prev;
          if (tx.add) {
            next = [...next, ...tx.add];
            if (next.length > VISIBLE_BUFFER_ROWS) {
              next = next.slice(-VISIBLE_BUFFER_ROWS);
            }
          }
          if (tx.update) {
            const byId = new Map<string, Partial<RaceRow>>();
            for (const p of tx.update) {
              const id = (p as { id?: string }).id;
              if (typeof id !== "string") continue;
              byId.set(id, { ...byId.get(id), ...p });
            }
            next = next.map((row) => {
              const patch = byId.get(row.id);
              return patch ? { ...row, ...patch } : row;
            });
          }
          return next;
        });
      },
    });
    replayRef.current = replay;
    return () => {
      replay.dispose();
      replayRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mount-once; rate/playing changes go through separate effects
  }, []);

  // React to rate changes
  useEffect(() => {
    replayRef.current?.setRate(ratePerSec);
  }, [ratePerSec]);

  // React to play/pause changes
  useEffect(() => {
    replayRef.current?.setPlaying(isPlaying);
  }, [isPlaying]);

  return (
    <section className={`hero ${styles.heroBackdrop}`}>
      <div className={styles.heroBezel} data-testid="hero-bezel">
        <div className={styles.heroSplit}>
          <div className={styles.heroSurface} ref={surfaceRef}>
            <PretableSurface<RaceRow>
              ariaLabel="Live ski racing"
              columns={raceColumns}
              getRowClassName={({ row }) =>
                row.delta === "LEADER" ? styles.leaderRow : undefined
              }
              getRowId={(row) => row.id}
              state={userSort ? { sort: userSort } : null}
              onSortChange={(next) => {
                if (next === null) {
                  setUserSort(null);
                  return;
                }
                // PretableSurface emits columnId as string; narrow to ColumnId.
                setUserSort({
                  columnId: next.columnId as ColumnId,
                  direction: next.direction,
                });
              }}
              rows={sortedRows}
              viewportHeight={viewportHeight}
            />
          </div>
          <div className={styles.heroSidebar}>
            <Scoreboard rows={rows} />
          </div>
        </div>
      </div>
    </section>
  );
}
