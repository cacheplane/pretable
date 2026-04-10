import { Pretable } from "@pretable/react";

const scenarios = [
  {
    id: "S1",
    name: "fixed-dense-text",
    purpose: "Simple baseline before variable height enters.",
    shape: "100k rows × 50 cols · fixed height",
  },
  {
    id: "S2",
    name: "wrap-auto-height",
    purpose: "Primary wedge benchmark for wrapped text and variable rows.",
    shape: "50k rows × 40 cols · 3 wrapped columns",
  },
  {
    id: "S3",
    name: "many-columns",
    purpose: "Column virtualization and pinned-zone overhead.",
    shape: "10k rows × 500 cols · 2 pinned left",
  },
  {
    id: "S4",
    name: "offscreen-autosize",
    purpose: "Unseen-column autosize accuracy check.",
    shape: "25k rows × 200 cols · autosize all columns",
  },
  {
    id: "S5",
    name: "streaming-updates",
    purpose: "Scheduler discipline and cache invalidation.",
    shape: "20k rows × 30 cols · batched updates every 50 ms",
  },
  {
    id: "S6",
    name: "light-rich-cells",
    purpose: "How fast richer cells break the simple path.",
    shape: "10k rows × 25 cols · 10% richer cells",
  },
];

const previewColumns = [
  { id: "scenario", header: "Scenario" },
  { id: "purpose", header: "Purpose" },
];

const previewRows = scenarios.slice(0, 3).map((scenario) => ({
  scenario: scenario.name,
  purpose: scenario.purpose,
}));

export function App() {
  return (
    <main className="bench-shell">
      <section className="bench-hero">
        <p className="eyebrow">Pretable benchmark lab</p>
        <h1>Bench the wedge, not the entire grid market.</h1>
        <p className="hero-copy">
          This scaffold is the future home of the browser-driven benchmark
          harness. Competitor routes, trace capture, and metric export wiring
          are still pending, but the scenario contract is already visible.
        </p>
      </section>

      <section className="bench-grid">
        <article className="scenario-panel">
          <header className="panel-header">
            <h2>Scenario queue</h2>
            <p>Aligned to the benchmark plan attached to the repo spec.</p>
          </header>

          <ul className="scenario-list">
            {scenarios.map((scenario) => (
              <li key={scenario.id} className="scenario-card">
                <div className="scenario-meta">
                  <span className="scenario-id">{scenario.id}</span>
                  <strong>{scenario.name}</strong>
                </div>
                <p>{scenario.purpose}</p>
                <small>{scenario.shape}</small>
              </li>
            ))}
          </ul>
        </article>

        <article className="preview-panel">
          <header className="panel-header">
            <h2>Harness preview</h2>
            <p>Placeholder grid mount using the public React adapter.</p>
          </header>

          <Pretable columns={previewColumns} rows={previewRows} />

          <div className="status-note">
            Competitor adapters, automated traces, and JSON metric summaries
            will land in later phases.
          </div>
        </article>
      </section>
    </main>
  );
}
