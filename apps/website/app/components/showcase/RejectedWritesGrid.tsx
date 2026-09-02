"use client";

import { PretableSurface, type PretableRejectedWrites } from "@pretable/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  cleanPage,
  corruptPage,
  makePositionColumns,
  type Position,
} from "./rejectedWritesData";
import { useInView } from "./useInView";

const VIEWPORT_HEIGHT = 360;

export function RejectedWritesGrid(props: {
  tickMs?: number;
  healMs?: number;
}) {
  const [mountRef, inView] = useInView<HTMLDivElement>();
  return (
    <div ref={mountRef} className="w-full">
      {inView ? (
        <RejectedWritesGridLive
          tickMs={props.tickMs ?? 1500}
          healMs={props.healMs ?? 6000}
        />
      ) : (
        <div
          aria-hidden
          style={{ height: VIEWPORT_HEIGHT + 96 }}
          className="w-full rounded-[8px] border border-rule bg-bg-card"
        />
      )}
    </div>
  );
}

/**
 * One atomic stream snapshot. `sentTick` is the last page the server sent;
 * `landedTick` is the tick of the last page the grid ACCEPTED — they differ
 * only across the diverged window, when `sentTick` names a page the model
 * refused. Holding both beside `rows` in one state object keeps every
 * transition (tick, corrupt, refetch) a single atomic commit; the
 * rejected-writes record, not this bookkeeping, decides which branch renders.
 */
interface StreamState {
  readonly sentTick: number;
  readonly landedTick: number;
  readonly rows: readonly Position[];
}

function RejectedWritesGridLive({
  tickMs,
  healMs,
}: {
  tickMs: number;
  healMs: number;
}) {
  const columns = useMemo(() => makePositionColumns(), []);
  const [stream, setStream] = useState<StreamState>(() => ({
    sentTick: 1,
    landedTick: 1,
    rows: cleanPage(1),
  }));
  const [rejected, setRejected] = useState<PretableRejectedWrites | null>(null);
  const corruptArmed = useRef(false);
  const corruptVariant = useRef(0);

  const diverged = rejected?.rows != null;

  /* The stream: one page per tick, paused while diverged. The arm flag is
   * consumed OUTSIDE the state updater so the updater stays pure (StrictMode
   * may invoke it twice). */
  useEffect(() => {
    if (diverged) return;
    const interval = setInterval(() => {
      const sendCorrupt = corruptArmed.current;
      corruptArmed.current = false;
      const variant = corruptVariant.current;
      if (sendCorrupt) corruptVariant.current += 1;
      setStream((current) => {
        const next = current.sentTick + 1;
        return sendCorrupt
          ? {
              sentTick: next,
              landedTick: current.landedTick,
              rows: corruptPage(next, variant),
            }
          : { sentTick: next, landedTick: next, rows: cleanPage(next) };
      });
    }, tickMs);
    return () => clearInterval(interval);
  }, [diverged, tickMs]);

  const refetch = useCallback(() => {
    setStream((current) => {
      const next = current.sentTick + 1;
      return { sentTick: next, landedTick: next, rows: cleanPage(next) };
    });
  }, []);

  /* Auto-heal: a diverged section resets itself for the next visitor. */
  useEffect(() => {
    if (!diverged) return;
    const timer = setTimeout(refetch, healMs);
    return () => clearTimeout(timer);
  }, [diverged, healMs, refetch]);

  const corrupt = () => {
    if (diverged) return;
    corruptArmed.current = true;
  };

  const gridTick = diverged ? stream.landedTick : stream.sentTick;

  return (
    <div>
      <div className="mb-3 flex items-center justify-between gap-4">
        <p
          className="font-mono text-[13px] text-text-secondary"
          data-testid="rw-status"
        >
          server sent tick{" "}
          <strong className="text-text-primary" data-testid="rw-sent-tick">
            {stream.sentTick}
          </strong>{" "}
          · grid shows tick{" "}
          <strong
            className={diverged ? "text-sev-warn" : "text-accent"}
            data-testid="rw-grid-tick"
          >
            {gridTick}
          </strong>
        </p>
        <button
          type="button"
          data-testid="rw-corrupt"
          onClick={corrupt}
          disabled={diverged}
          className="rounded-[6px] border border-rule px-3 py-1.5 font-mono text-[12px] text-text-secondary hover:text-text-primary disabled:opacity-40"
        >
          corrupt the next server page
        </button>
      </div>
      {rejected?.rows ? (
        <div
          role="status"
          data-testid="rw-banner"
          className="mb-3 flex items-center justify-between gap-4 rounded-[6px] border border-sev-warn/40 bg-sev-warn/10 px-4 py-2.5"
        >
          <p className="font-mono text-[12px] text-text-primary">
            <strong>{rejected.rows.code}</strong> — {rejected.rows.message} The
            grid kept tick {gridTick}; the rows on screen no longer match the
            last page sent.
          </p>
          <button
            type="button"
            data-testid="rw-refetch"
            onClick={refetch}
            className="shrink-0 rounded-[6px] bg-accent px-3 py-1.5 font-mono text-[12px] text-bg-page"
          >
            Refetch positions
          </button>
        </div>
      ) : null}
      <div className="overflow-hidden rounded-[8px] border border-rule">
        <PretableSurface
          ariaLabel="Streaming portfolio positions"
          columns={columns}
          getRowId={(row) => row.id}
          rows={stream.rows}
          viewportHeight={VIEWPORT_HEIGHT}
          onRejectedWriteChange={setRejected}
        />
      </div>
    </div>
  );
}
