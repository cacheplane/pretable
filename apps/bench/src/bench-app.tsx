import { useEffect, useEffectEvent, useRef, useState } from "react";

import {
  createScenarioDataset,
  getScenarioById,
  listScenarios,
} from "@pretable-internal/scenario-data";
import {
  createBenchRunSummary,
  createRunArtifactFileStem,
  validateSupportedP0aRequest,
  type BenchRunSummary,
} from "@pretable-internal/bench-runner";

import type { BenchQueryState } from "./bench-types";
import { createBenchRequest, publishBenchResult } from "./bench-runtime";
import { PretableAdapter } from "./pretable-adapter";
import { parseBenchQuery } from "./query-state";

export interface BenchAppProps {
  search: string;
  browserVersion: string;
}

const allScenarios = listScenarios();

function waitForNextAnimationFrame() {
  return new Promise<void>((resolve) => {
    requestAnimationFrame(() => {
      resolve();
    });
  });
}

export function BenchApp({ search, browserVersion }: BenchAppProps) {
  const query = parseBenchQuery(search);
  const dataset = createScenarioDataset(query.scenarioId);
  const [runKey, setRunKey] = useState(0);
  const [result, setResult] = useState<BenchRunSummary | null>(null);
  const viewportRef = useRef<HTMLDivElement>(null);
  const autorunRef = useRef(false);

  useEffect(() => {
    autorunRef.current = false;
  }, [search]);

  async function executeRun(scriptName: BenchQueryState["scriptName"]) {
    const nextQuery = {
      ...query,
      scriptName,
    } satisfies BenchQueryState;
    const request = createBenchRequest(nextQuery, dataset, browserVersion);
    const support = validateSupportedP0aRequest(request);
    const timestamp = new Date().toISOString();

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

    const startedAt = performance.now();

    setRunKey((current) => current + 1);
    await waitForNextAnimationFrame();

    const tracePath = `status/traces/${createRunArtifactFileStem({
      ...request,
      timestamp,
    })}.trace.zip`;
    const domNodesPeak = viewportRef.current?.querySelectorAll("*").length ?? 0;

    const nextResult =
      scriptName === "scroll"
        ? createBenchRunSummary({
            request,
            status: "partial",
            timestamp,
            tracePath,
            notes: ["scroll observer metrics unavailable in current runtime"],
            metrics: {
              dom_nodes_peak: domNodesPeak,
            },
          })
        : createBenchRunSummary({
            request,
            status: "completed",
            timestamp,
            tracePath,
            metrics: {
              mount_ms: performance.now() - startedAt,
              first_stable_viewport_ms: performance.now() - startedAt,
              dom_nodes_peak: domNodesPeak,
            },
          });

    setResult(nextResult);
    publishBenchResult(nextResult);
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
            <h2>Pretable harness</h2>
            <p>Deterministic `P0a` run surface for the public React adapter.</p>
          </header>

          <div className="run-toolbar">
            <button type="button" onClick={() => void executeRun("initial")}>
              Run Initial
            </button>
            <button type="button" onClick={() => void executeRun("scroll")}>
              Run Scroll
            </button>
          </div>

          <div ref={viewportRef} className="viewport-card">
            <PretableAdapter dataset={dataset} runKey={runKey} />
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
              <dt>Script</dt>
              <dd>{query.scriptName}</dd>
            </div>
            <div>
              <dt>Status</dt>
              <dd>{result?.status ?? "idle"}</dd>
            </div>
          </dl>

          {result ? (
            <pre className="result-json">
              {JSON.stringify(result, null, 2)}
            </pre>
          ) : (
            <p className="status-note">
              Run the selected scenario to publish a terminal benchmark result on
              `window.__PRETABLE_BENCH_RESULT__`.
            </p>
          )}
        </article>
      </section>
    </main>
  );
}
