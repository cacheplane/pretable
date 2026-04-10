import { Pretable } from "@pretable/react";

const columns = [
  { id: "message", header: "Message" },
  { id: "owner", header: "Owner" },
  { id: "status", header: "Status" },
];

const rows = [
  {
    message: "Wrapped text and autosize probes will land here first.",
    owner: "text-core",
    status: "queued",
  },
  {
    message: "Viewport math experiments should stay easy to isolate.",
    owner: "layout-core",
    status: "ready",
  },
  {
    message:
      "Renderer spikes belong in this playground before they hit benchmarks.",
    owner: "renderer-dom",
    status: "pending",
  },
];

const checks = [
  "Use this app for tiny repro pages before broad benchmark runs.",
  "Keep visual debugging fast enough that trace captures stay focused.",
  "Exercise the public React adapter while the engine is still placeholder code.",
];

export function App() {
  return (
    <main className="playground-shell">
      <section className="playground-hero">
        <div>
          <p className="eyebrow">Pretable playground</p>
          <h1>Manual debugging, tiny repros, and adapter smoke tests.</h1>
        </div>
        <div className="hero-card">
          <span>Current mode</span>
          <strong>Placeholder scaffold</strong>
        </div>
      </section>

      <section className="playground-grid">
        <article className="workspace-panel">
          <header>
            <h2>Repro workspace</h2>
            <p>
              Use this view to debug one interaction before it graduates to the
              bench app.
            </p>
          </header>
          <Pretable columns={columns} rows={rows} />
        </article>

        <article className="notes-panel">
          <header>
            <h2>Debug checklist</h2>
            <p>
              The first non-trivial grid work should stay small enough to reason
              about.
            </p>
          </header>
          <ol>
            {checks.map((check) => (
              <li key={check}>{check}</li>
            ))}
          </ol>
        </article>
      </section>
    </main>
  );
}
