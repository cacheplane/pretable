"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  PretableSurface,
  type PretableDataState,
  type PretableMatchingTotal,
  type PretableResultMeta,
  type PretableTelemetry,
} from "@pretable/react";

import { columns } from "./columns";
import { fetchWindow, type Order } from "./fetch-rows";

/** Records held in memory at once, out of the endpoint's 480. */
const PAGE_SIZE = 100;

/**
 * How far the window slides when the viewport runs off an edge. Half a block,
 * not a whole one: the viewport that produced the signal is sitting AT the
 * edge it reached, and a full-block slide would drop the rows underneath it —
 * leaving the reader parked over spacer, waiting on a request. Half keeps what
 * they are looking at loaded, and still bounds memory at one block.
 */
const WINDOW_STEP = 50;

const PROCESSING = { filter: "external", sort: "external" } as const;

/**
 * One population, never re-queried, so one key for the life of the grid.
 *
 * It has to be here at all because interaction state is recorded against
 * dataset positions, and a position only means something inside a named
 * population — see the datasetKey section on the lifecycle page.
 */
const DATASET_KEY = "docs-orders";

const VIEWPORT_HEIGHT = 320;

/**
 * The three facts that have to move together. A render that paired one block's
 * rows with the other block's `start` would announce every row at the wrong
 * dataset position, so they live in one state value and commit in one update.
 */
interface LoadedWindow {
  readonly start: number;
  readonly hasMore: boolean;
  readonly rows: Order[];
}

const NOTHING_LOADED: LoadedWindow = { start: 0, hasMore: false, rows: [] };

export function WindowedGrid() {
  const [requestedStart, setRequestedStart] = useState(0);
  const [loaded, setLoaded] = useState<LoadedWindow>(NOTHING_LOADED);
  const [total, setTotal] = useState<PretableMatchingTotal>({
    kind: "unknown",
  });
  const [fetchedRows, setFetchedRows] = useState(0);
  const [dataState, setDataState] = useState<PretableDataState>({
    phase: "loading",
  });

  // Whether a block has ever committed: the first request is `loading`,
  // because there is nothing on screen yet.
  const hasCommitted = useRef(false);
  // One request at a time. `windowGap` keeps reporting for as long as the
  // viewport is past the edge, which over the endpoint's 500 ms is many
  // frames' worth of telemetry describing one gap.
  const inFlight = useRef(false);
  // What has been ASKED for, which leads what is loaded by one request. Kept
  // in a ref as well as in state because telemetry can fire several times
  // inside a single commit, and a `setState` updater reading the value React
  // has not re-rendered with yet would step the window once per call — two
  // blocks skipped for one gap.
  const requested = useRef(0);

  useEffect(() => {
    let cancelled = false;

    inFlight.current = true;
    // The same query, more of the same population, and everything on screen
    // stays exactly where it is until the answer arrives — which is the phase
    // `loading-more` names. Nothing is drawn for it while rows are up.
    setDataState({ phase: hasCommitted.current ? "loading-more" : "loading" });

    fetchWindow(requestedStart, PAGE_SIZE).then(
      (result) => {
        if (cancelled) return;
        inFlight.current = false;
        hasCommitted.current = true;
        // Eviction, in one line: the block that was on screen is not merged
        // with this one, appended to, or kept beside it. It is dropped, and
        // the only thing that remembers it existed is the fetched-rows
        // counter below. There is no API for this — dropping rows you are not
        // showing is a thing you do, and the grid's contribution is not
        // noticing.
        setLoaded({
          start: result.start,
          hasMore: result.hasMore,
          rows: result.rows,
        });
        setTotal(result.total);
        setFetchedRows((count) => count + result.rows.length);
        setDataState({ phase: "idle" });
      },
      (error: unknown) => {
        if (cancelled) return;
        inFlight.current = false;
        hasCommitted.current = true;
        // Rows are left untouched: a failed request never discards the block
        // that did answer.
        setDataState({
          phase: "error",
          message: error instanceof Error ? error.message : "Request failed",
        });
      },
    );

    return () => {
      cancelled = true;
    };
  }, [requestedStart]);

  const onTelemetryChange = useCallback(
    (telemetry: PretableTelemetry<string>) => {
      const gap = telemetry.windowGap;
      // A hot path: this runs on scroll frames. `windowGap` is absent unless
      // the viewport is genuinely over rows that were never supplied, which is
      // why the grid computes it — it owns the geometry, and a consumer
      // thresholding a scroll offset would be reconstructing what is already
      // known.
      if (gap === undefined || inFlight.current) return;
      const next =
        gap.direction === "after"
          ? requested.current + WINDOW_STEP
          : Math.max(0, requested.current - WINDOW_STEP);
      // Standing at the top of the population: the "before" edge is the first
      // record, and there is nowhere to step back to.
      if (next === requested.current) return;
      // Both refs move before the state does, so a second report arriving in
      // the same commit finds the decision already made.
      requested.current = next;
      inFlight.current = true;
      setRequestedStart(next);
    },
    [],
  );

  const resultMeta = useMemo<PretableResultMeta>(
    () => ({
      total,
      datasetKey: DATASET_KEY,
      // `start` is the dataset index of `rows[0]` — the only thing telling the
      // grid these hundred records are not records 0–99. `hasMore` gates the
      // "after" edge: once nothing follows, there is nothing to fetch, and no
      // signal is reported.
      window: { start: loaded.start, hasMore: loaded.hasMore },
    }),
    [loaded.hasMore, loaded.start, total],
  );

  return (
    <div>
      <p role="status" style={{ margin: "0 0 8px", fontSize: 13 }}>
        Window starts at dataset row{" "}
        <code data-testid="window-start">{loaded.start}</code> ·{" "}
        <code data-testid="loaded-rows">{loaded.rows.length}</code> rows loaded
        · <code data-testid="fetched-rows">{fetchedRows}</code> rows fetched
        since this grid mounted. Scroll to the bottom and keep going: the
        position climbs and the fetch count climbs, while what is in memory does
        not.
      </p>
      <PretableSurface<Order>
        ariaLabel="Orders"
        columns={columns}
        dataState={dataState}
        getRowId={(row) => row.id}
        onTelemetryChange={onTelemetryChange}
        // The server chose these records and their order. Under a window that
        // claim is load-bearing rather than cosmetic: short of it, the grid
        // will not publish dataset positions at all, because a locally
        // re-filtered or re-sorted window has none to publish.
        processing={PROCESSING}
        resultMeta={resultMeta}
        rows={loaded.rows}
        viewportHeight={VIEWPORT_HEIGHT}
      />
    </div>
  );
}
