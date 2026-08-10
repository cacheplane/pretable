import {
  useCallback,
  useEffect,
  useEffectEvent,
  useMemo,
  useRef,
  useState,
} from "react";
import type { PretableGrid, PretableGroupRow } from "@pretable/react";
import type { PretableTelemetry } from "@pretable/react";

import {
  createScenarioDataset,
  getScenarioById,
  listScenarios,
  type ScenarioRow,
} from "@pretable-internal/scenario-data";
import {
  createBenchRunSummary,
  createRunArtifactFileStem,
  validateSupportedP0aRequest,
  type BenchRunSummary,
} from "@pretable-internal/bench-runner";

import type { BenchQueryState } from "./bench-types";
import {
  type ApplyBenchUpdates,
  createBenchInteractionStateFromTelemetry,
  createPretableTelemetryNotes,
  createBenchRequest,
  measureBenchAutosizeRun,
  measureBenchInteractionRun,
  measureBenchKeySequenceRun,
  measureBenchScrollRun,
  measureBenchUpdatesRun,
  publishBenchResult,
} from "./bench-runtime";
import { AgGridAdapter } from "./ag-grid-adapter";
import {
  benchUpdatesExcludedColumnIds,
  createBenchInteractionPlan,
} from "./interaction-plan";
import { MuiAdapter } from "./mui-adapter";
import { PretableAdapter } from "./pretable-adapter";
import { parseBenchQuery } from "./query-state";
import { TanstackAdapter } from "./tanstack-adapter";

export interface BenchAppProps {
  search: string;
  browserVersion: string;
}

const allScenarios = listScenarios();
const adapterRegistry = {
  "ag-grid": {
    heading: "AG Grid Community harness",
    description:
      "Community baseline using AG Grid v33 with themeQuartz, sortable + filter columns, and applyTransaction streaming updates.",
    render: AgGridAdapter,
  },
  pretable: {
    heading: "Pretable harness",
    description:
      "Deterministic `P0a` run surface for the public React adapter.",
    render: PretableAdapter,
  },
  tanstack: {
    heading: "TanStack Table harness",
    description:
      "Headless TanStack Table v8 + react-virtual baseline (real adapter ships in B2 Phase 2).",
    render: TanstackAdapter,
  },
  mui: {
    heading: "MUI X DataGrid Community harness",
    description:
      "Community baseline using MUI X DataGrid v7 (real adapter ships in B2 Phase 3).",
    render: MuiAdapter,
  },
} as const;

function waitForNextAnimationFrame() {
  return new Promise<void>((resolve) => {
    requestAnimationFrame(() => {
      resolve();
    });
  });
}

export function BenchApp({ search, browserVersion }: BenchAppProps) {
  const query = useMemo(() => parseBenchQuery(search), [search]);
  const dataset = useMemo(
    () => createScenarioDataset(query.scenarioId, { scale: query.scale }),
    [query.scenarioId, query.scale],
  );
  const adapterDefinition = adapterRegistry[query.adapterId];
  const AdapterSurface = adapterDefinition.render;
  const [runKey, setRunKey] = useState(0);
  const [interactionPlanOverride, setInteractionPlanOverride] = useState<{
    plan: ReturnType<typeof createBenchInteractionPlan>;
    search: string;
  } | null>(null);
  const [result, setResult] = useState<BenchRunSummary | null>(null);
  const viewportRef = useRef<HTMLDivElement>(null);
  const autorunRef = useRef(false);
  const pretableTelemetryRef = useRef<PretableTelemetry | null>(null);
  const pretableGridRef = useRef<PretableGrid<ScenarioRow> | null>(null);
  /**
   * Adapter-agnostic update API ref. Each adapter wires its idiomatic
   * streaming pattern (Pretable: stream-adapter batcher → applyTransaction;
   * AG Grid: gridApi.applyTransaction; MUI: setRows state merge; TanStack:
   * setData merge) and exposes a uniform `apply(patches)` callback here.
   */
  const updateApiRef = useRef<ApplyBenchUpdates | null>(null);
  const handleUpdateApiReady = useCallback((apply: ApplyBenchUpdates) => {
    updateApiRef.current = apply;
  }, []);
  /**
   * Adapter-agnostic autosize entry point. Each adapter calls back with
   * a closure over its native autosize API (pretable: grid.autosizeColumns;
   * ag-grid: gridApi.autoSizeColumns; mui: apiRef.autosizeColumns). The
   * autosize bench script awaits this callback and times to the next paint.
   */
  const autosizeApiRef = useRef<(() => Promise<void> | void) | null>(null);
  const handleAutosizeApiReady = useCallback(
    (autosize: () => Promise<void> | void) => {
      autosizeApiRef.current = autosize;
    },
    [],
  );
  const interactionPlan =
    interactionPlanOverride?.search === search
      ? interactionPlanOverride.plan
      : null;

  useEffect(() => {
    autorunRef.current = false;
    pretableTelemetryRef.current = null;
  }, [search]);

  /**
   * Wait for the grouped row model to exist and stop changing, then hand back
   * the first group row.
   *
   * `flatten` emits siblings in sorted order, so "first group row in
   * `visibleRows`" is the sorted-first group — which is what the
   * `group-expand` plan predicts when it picks a probe row from a *different*
   * group.
   *
   * Used only by the scripts that must be grouped BEFORE their measurement
   * window opens (`group-expand`, `group-updates`,
   * `group-updates-stable-keys`).
   */
  async function waitForGroupedRowModel(
    maxFrames = 120,
  ): Promise<PretableGroupRow | null> {
    let previousRowCount = -1;
    let stableFrames = 0;

    for (let frame = 0; frame < maxFrames; frame += 1) {
      await waitForNextAnimationFrame();
      const grid = pretableGridRef.current;

      if (!grid) {
        // No pretable grid was ever published (only pretable reaches here, so
        // in practice this is a test double). Give it a few frames, then stop
        // rather than burning the whole budget.
        if (frame >= 12) {
          return null;
        }
        continue;
      }

      const { visibleRows } = grid.getSnapshot();
      const firstGroupRow = visibleRows.find((row) => row.kind === "group");

      if (!firstGroupRow) {
        previousRowCount = -1;
        stableFrames = 0;
        continue;
      }

      if (visibleRows.length === previousRowCount) {
        stableFrames += 1;

        if (stableFrames >= 3) {
          return firstGroupRow;
        }
      } else {
        previousRowCount = visibleRows.length;
        stableFrames = 0;
      }
    }

    return (
      pretableGridRef.current
        ?.getSnapshot()
        .visibleRows.find((row) => row.kind === "group") ?? null
    );
  }

  function countGroupRows() {
    const snapshot = pretableGridRef.current?.getSnapshot();

    return (
      snapshot?.visibleRows.filter((row) => row.kind === "group").length ?? 0
    );
  }

  async function executeRun(scriptName: BenchQueryState["scriptName"]) {
    const nextQuery = {
      ...query,
      scriptName,
    } satisfies BenchQueryState;
    const request = createBenchRequest(nextQuery, dataset, browserVersion);
    const support = validateSupportedP0aRequest(request);
    const timestamp = new Date().toISOString();
    const tracePath = `status/traces/${createRunArtifactFileStem({
      ...request,
      timestamp,
    })}.trace.zip`;

    if (!support.ok) {
      const unsupportedResult = createBenchRunSummary({
        request,
        status: "unsupported",
        timestamp,
        reason: support.reason,
      });
      setResult(unsupportedResult);
      publishBenchResult(unsupportedResult);
      return;
    }

    try {
      const startedAt = performance.now();
      pretableTelemetryRef.current = null;
      setInteractionPlanOverride({
        plan: null,
        search,
      });

      // Clear adapter-published refs before remount so the wait loops below
      // observe a stale-free state and only resolve on the new adapter's
      // onReady callbacks.
      updateApiRef.current = null;
      autosizeApiRef.current = null;

      setRunKey((current) => current + 1);
      await waitForNextAnimationFrame();

      if (
        scriptName === "scroll" ||
        scriptName === "scroll-with-format" ||
        scriptName === "scroll-with-render" ||
        scriptName === "scroll-with-heavy-render"
      ) {
        // AG Grid v33's body viewport attaches one frame later than the
        // outer adapter section becomes visible; without this extra wait,
        // measureBenchScrollRun's viewport polling hits "unavailable" on
        // a fresh mount with cell-renderer columnDefs.
        await waitForNextAnimationFrame();
      }

      const domNodesPeak =
        viewportRef.current?.querySelectorAll("*").length ?? 0;

      const scrollRun =
        scriptName === "scroll" ||
        scriptName === "scroll-with-format" ||
        scriptName === "scroll-with-render" ||
        scriptName === "scroll-with-heavy-render"
          ? await measureBenchScrollRun(
              viewportRef.current ?? document.body,
              query.adapterId,
            )
          : null;
      // Extra notes for the row-grouping scripts: which levels were applied,
      // how many groups the model actually produced, and (for group-expand)
      // which group the measured toggle collapsed.
      const groupingNotes: string[] = [];

      const interactionRun =
        scriptName === "sort" ||
        scriptName === "filter-metadata" ||
        scriptName === "filter-text" ||
        // `group` applies the grouping INSIDE the window — that is the thing
        // being measured — so it takes the ordinary interaction path.
        scriptName === "group"
          ? await (() => {
              const nextInteractionPlan = createBenchInteractionPlan(
                dataset,
                scriptName,
              );

              if (!nextInteractionPlan) {
                return Promise.resolve(null);
              }

              return measureBenchInteractionRun(
                viewportRef.current ?? document.body,
                query.adapterId,
                scriptName,
                nextInteractionPlan,
                // Telemetry-based state reading is pretable-only (uses
                // PretableTelemetry visible-rows snapshot). Comparators
                // fall back to DOM-default state reading.
                query.adapterId === "pretable"
                  ? () =>
                      createBenchInteractionStateFromTelemetry(
                        pretableTelemetryRef.current,
                        dataset.rows.length,
                      )
                  : undefined,
                () => {
                  setInteractionPlanOverride({
                    plan: nextInteractionPlan,
                    search,
                  });
                },
              );
            })()
          : scriptName === "group-expand"
            ? await (async () => {
                const nextInteractionPlan = createBenchInteractionPlan(
                  dataset,
                  scriptName,
                );

                if (!nextInteractionPlan) {
                  return null;
                }

                // SETUP — outside the measurement window. Apply the grouping
                // and let the model settle. If this landed inside the window
                // its recompute would swamp the toggle and the script would
                // measure nothing.
                setInteractionPlanOverride({
                  plan: nextInteractionPlan,
                  search,
                });
                const firstGroupRow = await waitForGroupedRowModel();
                const grid = pretableGridRef.current;

                if (!firstGroupRow || !grid) {
                  return {
                    status: "partial" as const,
                    notes: [
                      `interaction mode: ${scriptName}`,
                      "grouped row model unavailable before the measurement window",
                    ],
                    metrics: {
                      dom_nodes_peak:
                        viewportRef.current?.querySelectorAll("*").length ?? 0,
                    },
                  };
                }

                groupingNotes.push(
                  `grouping levels: ${nextInteractionPlan.rowGroups.join(", ")}`,
                  `group rows before toggle: ${countGroupRows()}`,
                  `collapsed group id: ${firstGroupRow.id}`,
                  `collapsed group child count: ${firstGroupRow.childCount}`,
                );

                // MEASURED — one `setGroupExpanded`, the same call the twisty
                // click funnels through, and nothing else.
                return measureBenchInteractionRun(
                  viewportRef.current ?? document.body,
                  query.adapterId,
                  scriptName,
                  nextInteractionPlan,
                  () =>
                    createBenchInteractionStateFromTelemetry(
                      pretableTelemetryRef.current,
                      dataset.rows.length,
                    ),
                  () => {
                    grid.setGroupExpanded(firstGroupRow.id, false);
                  },
                );
              })()
            : null;

      if (scriptName === "group" && interactionRun) {
        groupingNotes.push(
          `grouping levels: ${createBenchInteractionPlan(dataset, scriptName)?.rowGroups.join(", ") ?? ""}`,
          `group rows after grouping: ${countGroupRows()}`,
        );
      }

      const keySequenceRun =
        scriptName === "select-range-extend"
          ? query.adapterId === "pretable"
            ? await measureBenchKeySequenceRun(
                viewportRef.current ?? document.body,
                query.adapterId,
                scriptName,
                { key: "ArrowDown", shiftKey: true, count: 30 },
              )
            : null
          : scriptName === "keyboard-nav-row"
            ? query.adapterId === "pretable"
              ? await measureBenchKeySequenceRun(
                  viewportRef.current ?? document.body,
                  query.adapterId,
                  scriptName,
                  { key: "ArrowDown", count: 60 },
                )
              : null
            : scriptName === "select-all"
              ? query.adapterId === "pretable"
                ? await measureBenchKeySequenceRun(
                    viewportRef.current ?? document.body,
                    query.adapterId,
                    scriptName,
                    { key: "a", metaKey: true, count: 1 },
                  )
                : null
              : null;

      // Wait up to ~1s for the current adapter to publish its autosize API.
      // Like onGridReady, autosize callbacks are wired asynchronously after
      // mount on AG Grid / MUI; without this the very first autosize run
      // races past readiness.
      if (scriptName === "autosize" && !autosizeApiRef.current) {
        for (let i = 0; i < 60 && !autosizeApiRef.current; i++) {
          await waitForNextAnimationFrame();
        }
      }

      const autosizeRun =
        scriptName === "autosize"
          ? await measureBenchAutosizeRun(
              viewportRef.current ?? document.body,
              query.adapterId,
              autosizeApiRef.current,
            )
          : null;

      const isGroupedUpdatesScript =
        scriptName === "group-updates" ||
        scriptName === "group-updates-stable-keys";
      const isUpdatesScript =
        scriptName === "updates" || isGroupedUpdatesScript;

      // SETUP for the grouped streaming scripts — outside the streaming
      // window. The grid has to be grouped (and its aggregates configured,
      // which the adapter does off `scriptName`) before the first patch lands,
      // otherwise the run measures the grouping being applied rather than
      // streaming into a grouped grid.
      if (isGroupedUpdatesScript) {
        const groupUpdatesPlan = createBenchInteractionPlan(
          dataset,
          scriptName,
        );

        if (groupUpdatesPlan) {
          setInteractionPlanOverride({ plan: groupUpdatesPlan, search });
          await waitForGroupedRowModel();
          groupingNotes.push(
            `grouping levels: ${groupUpdatesPlan.rowGroups.join(", ")}`,
            `group rows before streaming: ${countGroupRows()}`,
          );
        }
      }

      // Wait up to ~1s for the current adapter to publish its update API.
      // AG Grid in particular fires onGridReady asynchronously a few RAFs
      // after mount, so kicking off the updates script in the very next
      // frame after setRunKey would race past it and leave updateApiRef
      // null (no metrics get collected).
      let updatesApi = updateApiRef.current;
      if (isUpdatesScript && !updatesApi) {
        for (let i = 0; i < 60 && !updateApiRef.current; i++) {
          await waitForNextAnimationFrame();
        }
        updatesApi = updateApiRef.current;
      }

      const updatesRun =
        isUpdatesScript && updatesApi
          ? await measureBenchUpdatesRun(
              viewportRef.current ?? document.body,
              query.adapterId,
              updatesApi,
              dataset,
              {
                updateRatePerSec: query.updateRatePerSec,
                excludeColumnIds: benchUpdatesExcludedColumnIds(scriptName),
              },
            )
          : null;

      if (isGroupedUpdatesScript && updatesRun) {
        // `group-updates`: the patch generator picks a random column per
        // patch, including the grouping level, so streamed values mint
        // brand-new group keys. That churn is deliberately left in — changing
        // the generator would break comparability with `updates` — but it has
        // to be reported.
        //
        // `group-updates-stable-keys`: the grouping level is excluded from the
        // pool, so the group count below must come back equal to the
        // pre-streaming one. The two notes together are what let a reader tell
        // the variants apart from the artifact alone.
        groupingNotes.push(
          `group rows after streaming: ${countGroupRows()}`,
          scriptName === "group-updates"
            ? "note: patched columns include the grouping level, so group churn is part of this measurement"
            : "note: the grouping level is excluded from the patch pool, so group membership is stable and this measures grouping under streaming without key churn",
        );
      }

      const nextResult =
        (scriptName === "scroll" ||
          scriptName === "scroll-with-format" ||
          scriptName === "scroll-with-render" ||
          scriptName === "scroll-with-heavy-render") &&
        scrollRun
          ? createBenchRunSummary({
              request,
              status: scrollRun.status,
              timestamp,
              tracePath,
              notes: [
                ...scrollRun.notes,
                ...createPretableTelemetryNotes(pretableTelemetryRef.current),
              ],
              metrics: scrollRun.metrics,
            })
          : (scriptName === "select-range-extend" ||
                scriptName === "keyboard-nav-row" ||
                scriptName === "select-all") &&
              keySequenceRun
            ? createBenchRunSummary({
                request,
                status: keySequenceRun.status,
                timestamp,
                tracePath,
                notes: [
                  ...keySequenceRun.notes,
                  ...createPretableTelemetryNotes(pretableTelemetryRef.current),
                ],
                metrics: keySequenceRun.metrics,
              })
            : isUpdatesScript && updatesRun
              ? createBenchRunSummary({
                  request,
                  status: updatesRun.status,
                  timestamp,
                  tracePath,
                  notes: [
                    ...updatesRun.notes,
                    ...groupingNotes,
                    ...createPretableTelemetryNotes(
                      pretableTelemetryRef.current,
                    ),
                  ],
                  metrics: updatesRun.metrics,
                })
              : scriptName === "autosize" && autosizeRun
                ? createBenchRunSummary({
                    request,
                    status: autosizeRun.status,
                    timestamp,
                    tracePath,
                    notes: [
                      ...autosizeRun.notes,
                      ...createPretableTelemetryNotes(
                        pretableTelemetryRef.current,
                      ),
                    ],
                    metrics: autosizeRun.metrics,
                  })
                : interactionRun
                  ? createBenchRunSummary({
                      request,
                      status: interactionRun.status,
                      timestamp,
                      tracePath,
                      notes: [
                        ...interactionRun.notes,
                        ...groupingNotes,
                        ...createPretableTelemetryNotes(
                          pretableTelemetryRef.current,
                        ),
                      ],
                      metrics: interactionRun.metrics,
                    })
                  : createBenchRunSummary({
                      request,
                      status: "completed",
                      timestamp,
                      tracePath,
                      notes: createPretableTelemetryNotes(
                        pretableTelemetryRef.current,
                      ),
                      metrics: {
                        mount_ms: performance.now() - startedAt,
                        first_stable_viewport_ms: performance.now() - startedAt,
                        dom_nodes_peak: domNodesPeak,
                      },
                    });

      setResult(nextResult);
      publishBenchResult(nextResult);
    } catch (error) {
      const failedResult = createBenchRunSummary({
        request,
        status: "failed",
        timestamp,
        tracePath,
        error: serializeBenchError(error),
      });

      setResult(failedResult);
      publishBenchResult(failedResult);
    }
  }

  const autorunScript = useEffectEvent(
    async (scriptName: BenchQueryState["scriptName"]) => {
      await executeRun(scriptName);
    },
  );

  useEffect(() => {
    if (!query.autorun || autorunRef.current) {
      return;
    }
    autorunRef.current = true;

    let cancelled = false;
    const run = () => {
      if (cancelled) return;
      void autorunScript(query.scriptName);
    };

    if (!query.waitForTrigger) {
      run();
      return;
    }

    const tick = () => {
      if (cancelled) return;
      if (window.__PRETABLE_BENCH_START__ === true) {
        run();
        return;
      }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
    return () => {
      cancelled = true;
    };
  }, [query.autorun, query.waitForTrigger, query.scriptName]);

  const selectedScenario = getScenarioById(query.scenarioId);

  return (
    <main className="bench-shell">
      <section className="bench-hero">
        <p className="eyebrow">Pretable benchmark lab</p>
        <h1>Bench the wedge, not the entire grid market.</h1>
        <p className="hero-copy">
          P0a wires the deterministic browser harness for Pretable first. The
          same adapter, scenario, and artifact contract is ready for competitor
          adapters next.
        </p>
      </section>

      <section className="bench-grid">
        <article className="scenario-panel">
          <header className="panel-header">
            <h2>Scenario registry</h2>
            <p>Active scenario and the full benchmark-plan queue.</p>
          </header>

          <div className="active-scenario">
            <span className="scenario-id">{selectedScenario.id}</span>
            <div>
              <strong>{selectedScenario.name}</strong>
              <p>{selectedScenario.purpose}</p>
            </div>
          </div>

          <ul className="scenario-list">
            {allScenarios.map((scenario) => (
              <li key={scenario.id} className="scenario-card">
                <div className="scenario-meta">
                  <span className="scenario-id">{scenario.id}</span>
                  <strong>{scenario.name}</strong>
                </div>
                <p>{scenario.purpose}</p>
                <small>
                  {scenario.rows.toLocaleString()} rows · {scenario.cols} cols
                </small>
              </li>
            ))}
          </ul>
        </article>

        <article className="preview-panel">
          <header className="panel-header">
            <h2>{adapterDefinition.heading}</h2>
            <p>{adapterDefinition.description}</p>
          </header>

          <div className="run-toolbar">
            <button type="button" onClick={() => void executeRun("initial")}>
              Run Initial
            </button>
            <button type="button" onClick={() => void executeRun("scroll")}>
              Run Scroll
            </button>
            <button type="button" onClick={() => void executeRun("sort")}>
              Run Sort
            </button>
            <button
              type="button"
              onClick={() => void executeRun("filter-metadata")}
            >
              Run Metadata Filter
            </button>
            <button
              type="button"
              onClick={() => void executeRun("filter-text")}
            >
              Run Text Filter
            </button>
            <button type="button" onClick={() => void executeRun("updates")}>
              Run Updates
            </button>
          </div>

          <div ref={viewportRef} className="viewport-card">
            {query.adapterId === "pretable" ? (
              <PretableAdapter
                dataset={dataset}
                interactionPlan={interactionPlan}
                key={runKey}
                onAutosizeReady={handleAutosizeApiReady}
                onGridReady={(grid) => {
                  pretableGridRef.current = grid;
                }}
                onTelemetryChange={(telemetry) => {
                  pretableTelemetryRef.current = telemetry;
                }}
                onUpdateApiReady={handleUpdateApiReady}
                runKey={runKey}
                scriptName={query.scriptName}
              />
            ) : (
              <AdapterSurface
                dataset={dataset}
                interactionPlan={interactionPlan}
                key={runKey}
                onAutosizeReady={handleAutosizeApiReady}
                onUpdateApiReady={handleUpdateApiReady}
                runKey={runKey}
                scriptName={query.scriptName}
              />
            )}
          </div>

          <dl className="result-grid">
            <div>
              <dt>Adapter</dt>
              <dd>{query.adapterId}</dd>
            </div>
            <div>
              <dt>Profile</dt>
              <dd>{query.profile}</dd>
            </div>
            <div>
              <dt>Scale</dt>
              <dd>{query.scale}</dd>
            </div>
            <div>
              <dt>Script</dt>
              <dd>{query.scriptName}</dd>
            </div>
            <div>
              <dt>Status</dt>
              <dd>{result?.status ?? "idle"}</dd>
            </div>
          </dl>

          {result ? (
            <pre className="result-json">{JSON.stringify(result, null, 2)}</pre>
          ) : (
            <p className="status-note">
              Run the selected scenario to publish a terminal benchmark result
              on `window.__PRETABLE_BENCH_RESULT__`.
            </p>
          )}
        </article>
      </section>
    </main>
  );
}

function serializeBenchError(error: unknown) {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      stack: error.stack,
    };
  }

  return {
    name: "UnknownError",
    message: String(error),
  };
}
