/* global document, probe -- callbacks execute in the isolated fixture page */
// Reproducible local-only geometry experiment; no production page or server.
// Run: node scripts/probe-remote-layout.mjs
import { chromium, webkit } from "@playwright/test";
import ts from "typescript";
import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
const source = ts.transpileModule(
  readFileSync(
    new URL("../packages/renderer-dom/src/remote-layout.ts", import.meta.url),
    "utf8",
  ),
  {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ES2022,
    },
  },
).outputText;
const moduleURL = `data:text/javascript;base64,${Buffer.from(source).toString("base64")}`;
const evidence = [];
for (const [name, engine] of Object.entries({ chromium, webkit })) {
  const browser = await engine.launch({ headless: true });
  try {
    const page = await browser.newPage({
      viewport: { width: 900, height: 800 },
    });
    await page.setContent(
      '<style>*{box-sizing:border-box}body{margin:0}#port{height:600px;width:600px;overflow:auto;position:relative;overflow-anchor:none}#space{position:relative;width:100%}.row{position:absolute;width:100%;background:#cde}</style><div id="port"><div id="space"></div></div>',
    );
    const caps = await page.evaluate(() => {
      const port = document.querySelector("#port"),
        space = document.querySelector("#space");
      return [1000000, 8000000, 16000000, 32000000, 64000000, 1000000000].map(
        (requested) => {
          space.style.height = `${requested}px`;
          port.scrollTop = requested;
          return {
            requested,
            scrollHeight: port.scrollHeight,
            maxScrollTop: port.scrollTop,
            rectHeight: space.getBoundingClientRect().height,
          };
        },
      );
    });
    await page.evaluate(async (url) => {
      const { RemoteScrollMapping, RemoteMetrics } = await import(url);
      const port = document.querySelector("#port"),
        space = document.querySelector("#space");
      const ranks = new Map([
        ["anchor", 80000000],
        ["before", 2],
      ]);
      const metrics = new RemoteMetrics(100000000, 20, 2, (id) =>
        ranks.get(id),
      );
      const state = {
        ranks,
        metrics,
        mapping: new RemoteScrollMapping(
          metrics.getTotalHeight(),
          600,
          8000000,
        ),
        port,
        space,
      };
      function paint() {
        const m = state.mapping;
        space.style.height = `${m.domHeight}px`;
        port.scrollTop = m.domScrollTop;
        space.replaceChildren();
        const first = metrics.getIndexForOffset(m.logicalScrollTop);
        for (
          let rank = first;
          rank < Math.min(metrics.rowCount, first + 34);
          rank++
        ) {
          const row = document.createElement("div");
          row.className = "row";
          row.dataset.rank = String(rank);
          row.dataset.id =
            rank === ranks.get("anchor") ? "anchor" : `slot-${rank}`;
          row.dataset.logicalTop = String(metrics.getOffsetForIndex(rank));
          row.style.top = `${m.toDOMRowTop(metrics.getOffsetForIndex(rank), port.scrollTop)}px`;
          row.style.height = `${metrics.getHeight(rank)}px`;
          row.textContent = row.dataset.id;
          space.append(row);
        }
      }
      port.addEventListener(
        "wheel",
        (event) => {
          event.preventDefault();
          state.mapping.moveBy(event.deltaY);
          paint();
        },
        { passive: false },
      );
      state.paint = paint;
      state.read = () => {
        const viewport = port.getBoundingClientRect();
        const rows = [...space.children].map((row) => {
          const rect = row.getBoundingClientRect();
          return {
            id: row.dataset.id,
            rank: Number(row.dataset.rank),
            logicalTop: Number(row.dataset.logicalTop),
            top: rect.top - viewport.top,
            height: rect.height,
            intersects:
              rect.bottom > viewport.top && rect.top < viewport.bottom,
          };
        });
        return {
          ...state.mapping.telemetry(),
          domScrollTop: port.scrollTop,
          plannedDOMScrollTop: state.mapping.domScrollTop,
          rows,
          hit: document.elementFromPoint(100, 10)?.dataset.id,
        };
      };
      globalThis.probe = state;
      state.mapping.fromDOM(state.mapping.domRange * 0.8);
      paint();
    }, moduleURL);
    const distant = await page.evaluate(() => probe.read());
    assert(distant.rows.some((r) => r.intersects));
    for (const row of distant.rows.filter((r) => r.intersects))
      assert(Math.abs(row.top - (row.logicalTop - distant.scrollTop)) < 1.1);
    await page.mouse.move(200, 200);
    await page.mouse.wheel(0, 40);
    await page.waitForFunction(
      (top) => probe.mapping.logicalScrollTop === top + 40,
      distant.scrollTop,
    );
    const wheel = await page.evaluate(() => probe.read());
    assert.equal(wheel.scrollTop - distant.scrollTop, 40);
    assert(wheel.rows.some((r) => r.intersects));
    const anchors = await page.evaluate(() => {
      const p = probe;
      p.mapping.seek(p.metrics.getOffsetForIndex(p.ranks.get("anchor")) + 7);
      p.paint();
      const before = p.read();
      const anchor = p.metrics.captureAnchor(
        "anchor",
        p.mapping.logicalScrollTop,
      );
      p.metrics.measure("before", 90);
      p.ranks.set("anchor", 50000000); // expansion/collapse moves stable identity
      p.metrics.sync(70000000, (id) => p.ranks.get(id));
      p.mapping = new p.mapping.constructor(
        p.metrics.getTotalHeight(),
        600,
        8000000,
      );
      p.mapping.seek(p.metrics.restoreAnchor(anchor));
      p.paint();
      const after = p.read();
      p.metrics.invalidateMeasurements();
      p.mapping = new p.mapping.constructor(
        p.metrics.getTotalHeight(),
        600,
        8000000,
      );
      p.mapping.seek(p.metrics.restoreAnchor(anchor));
      p.paint();
      return { before, after, invalidated: p.read() };
    });
    for (const snapshot of Object.values(anchors)) {
      const anchor = snapshot.rows.find((r) => r.id === "anchor");
      assert(anchor?.intersects);
      assert(Math.abs(anchor.top + 7) < 1.1);
    }
    const roundTrip = await page.evaluate(() => {
      const p = probe;
      p.mapping.reveal(p.metrics.getTotalHeight() - 20, 20);
      p.paint();
      const end = p.read();
      const expected = p.mapping.logicalScrollTop;
      p.mapping.fromDOM(p.port.scrollTop);
      p.paint();
      return { expected, end, returned: p.read() };
    });
    assert(Math.abs(roundTrip.returned.scrollTop - roundTrip.expected) < 1);
    assert(roundTrip.end.rows.some((r) => r.intersects && r.rank === 69999999));
    const compact = (snapshot) => ({
      scrollTop: snapshot.scrollTop,
      domScrollTop: snapshot.domScrollTop,
      firstIntersecting: snapshot.rows.find((r) => r.intersects),
      hit: snapshot.hit,
    });
    evidence.push({
      engine: name,
      version: browser.version(),
      caps,
      distant: compact(distant),
      wheel: compact(wheel),
      anchors: Object.fromEntries(
        Object.entries(anchors).map(([key, value]) => [key, compact(value)]),
      ),
      roundTrip: {
        expected: roundTrip.expected,
        returned: roundTrip.returned.scrollTop,
        lastIntersecting: roundTrip.end.rows.filter((r) => r.intersects).at(-1),
      },
    });
  } finally {
    await browser.close();
  }
}
console.log(
  JSON.stringify({ recordedAt: new Date().toISOString(), evidence }, null, 2),
);
