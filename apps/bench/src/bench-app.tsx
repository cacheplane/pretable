import { useEffect, useEffectEvent, useMemo, useRef, useState } from "react";
import type { PretableGrid } from "@pretable/react";
import type { PretableTelemetry } from "@pretable/react/internal";

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
  createBenchInteractionStateFromTelemetry,
  createPretableTelemetryNotes,
  createBenchRequest,
  measureBenchInteractionRun,
  measureBenchScrollRun,
  measureBenchUpdatesRun,
  publishBenchResult,
} from "./bench-runtime";
import { AGGridAdapter } from "./ag-grid-adapter";
import { createBenchInteractionPlan } from "./interaction-plan";
import { MuiAdapter } from "./mui-adapter";
import { PretableAdapter } from "./pretable-adapter";
import { parseBenchQuery } from "./query-state";
import { TanStackAdapter } from "./tanstack-adapter";

export interface BenchAppProps {
  search: string;
  browserVersion: string;
}

const allScenarios = listScenarios();
const adapterRegistry = {
  "ag-grid": {
    heading: "AG Grid harness",
    description:
      "Community baseline using the vendor-documented wrapped-text and auto-height path.",
    render: AGGridAdapter,
  },
  pretable: {
    heading: "Pretable harness",
    description:
      "Deterministic `P0a` run surface for the public React adapter.",
    render: PretableAdapter,
  },
  tanstack: {
    heading: "TanStack Virtual harness",
    description:
      "Primitive virtualization baseline using TanStack's measured dynamic-row path.",
    render: TanStackAdapter,
  },
  mui: {
    heading: "MUI Data Grid harness",
    description:
      "Community baseline using the vendor-documented auto-height row path.",
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
  const interactionPlan =
    interactionPlanOverride?.search === search
      ? interactionPlanOverride.plan
      : null;

  useEffect(() => {
    autorunRef.current = false;
    pretableTelemetryRef.current = null;
  }, [search]);

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

      setRunKey((current) => current + 1);
      await waitForNextAnimationFrame();

      if (scriptName === "scroll") {
        await waitForNextAnimationFrame();
      }

      const domNodesPeak =
        viewportRef.current?.querySelectorAll("*").length ?? 0;

      const scrollRun =
        scriptName === "scroll"
          ? await measureBenchScrollRun(
              viewportRef.current ?? document.body,
              query.adapterId,
            )
          : null;
      const interactionRun =
        scriptName === "sort" ||
        scriptName === "filter-metadata" ||
        scriptName === "filter-text"
          ? query.adapterId === "pretable"
            ? await (() => {
                const nextInteractionPlan = createBenchInteractionPlan(
                  dataset,
                  scriptName,
                );

                if (!nextInteractionPlan) {
                  return null;
                }

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
                    setInteractionPlanOverride({
                      plan: nextInteractionPlan,
                      search,
                    });
                  },
                );
              })()
            : null
          : null;

      const updatesRun =
        scriptName === "updates" && pretableGridRef.current
          ? await measureBenchUpdatesRun(
              viewportRef.current ?? document.body,
              pretableGridRef.current,
              dataset,
            )
          : null;

      const nextResult =
        scriptName === "scroll" && scrollRun
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
          : scriptName === "updates" && updatesRun
            ? createBenchRunSummary({
                request,
                status: updatesRun.status,
                timestamp,
                tracePath,
                notes: [
                  ...updatesRun.notes,
                  ...createPretableTelemetryNotes(pretableTelemetryRef.current),
                ],
                metrics: updatesRun.metrics,
              })
            : interactionRun
              ? createBenchRunSummary({
                  request,
                  status: interactionRun.status,
                  timestamp,
                  tracePath,
                  notes: [
                    ...interactionRun.notes,
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
    void autorunScript(query.scriptName);
  }, [query.autorun, query.scriptName]);

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
                onGridReady={(grid) => {
                  pretableGridRef.current = grid;
                }}
                onTelemetryChange={(telemetry) => {
                  pretableTelemetryRef.current = telemetry;
                }}
                runKey={runKey}
              />
            ) : (
              <AdapterSurface dataset={dataset} key={runKey} runKey={runKey} />
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
