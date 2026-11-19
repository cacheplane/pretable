/* global document, probe, WheelEvent -- callbacks execute in the isolated fixture page */
// Reproducible local-only geometry experiment; no production page or server.
// Run: node scripts/probe-remote-layout.mjs
import { chromium, webkit } from "@playwright/test";
import ts from "typescript";
import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
function moduleURL(path) {
  const file = new URL(path, import.meta.url);
  let source = ts.transpileModule(readFileSync(file, "utf8"), {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ES2022,
    },
  }).outputText;
  source = source.replace(/from ["']([^"']+)["']/g, (match, specifier) => {
    const dependency =
      specifier === "@pretable-internal/layout-core"
        ? new URL("../packages/layout-core/src/read-layout.ts", import.meta.url)
        : new URL(`${specifier}.ts`, file);
    return `from ${JSON.stringify(moduleURL(dependency))}`;
  });
  return `data:text/javascript;base64,${Buffer.from(source).toString("base64")}`;
}
const runtimeURL = moduleURL("../packages/renderer-dom/src/remote-layout.ts");
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
      const {
        RemoteScrollMapping,
        RemoteMetrics,
        RemoteScrollInput,
        RemoteLayoutAdapter,
        remoteLayoutNodeKey,
      } = await import(url);
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
      state.adapter = new RemoteLayoutAdapter({
        estimate: 20,
        measurementCap: 2,
      });
      state.input = new RemoteScrollInput(state.mapping, () => 20);
      function paint() {
        if (state.input.mapping !== state.mapping)
          state.input = new RemoteScrollInput(state.mapping, () => 20);
        const m = state.mapping;
        space.style.height = `${m.domHeight}px`;
        port.scrollTop = m.domScrollTop;
        state.input.recordDOM(port.scrollTop);
        space.replaceChildren();
        const loaded = [...ranks].map(([id, index]) => ({
          index,
          node: { kind: "leaf", id, row: { id } },
        }));
        const snapshot = {
          status: { state: "idle" },
          generation: 1,
          rootCount: metrics.rowCount,
          displayCount: metrics.rowCount,
          residentCount: loaded.length,
          residentLeafCount: loaded.length,
          residentGroupCount: 0,
          loadedEntries: () => loaded,
          readSlot(index) {
            if (index < 0 || index >= metrics.rowCount) return;
            const found = loaded.find((entry) => entry.index === index);
            return found
              ? { kind: "loaded", node: found.node }
              : { kind: "unloaded", route: [], ordinal: index };
          },
          getSummary: () => ({ state: "unavailable" }),
        };
        const pending = state.adapter.prepare(snapshot);
        while (!pending.advance(16)) {
          /* fixture has only two resident records */
        }
        if (!pending.commit())
          throw new Error("Adapter rejected browser fixture");
        state.adapter.measureBatch(
          loaded.map((entry) => ({
            id: remoteLayoutNodeKey(entry.node),
            height: metrics.getHeight(entry.index),
          })),
        );
        state.adapter.setViewport({
          scrollTop: m.logicalScrollTop,
          viewportHeight: 600,
          overscan: 2,
        });
        for (const geometry of state.adapter.getState().rows) {
          const rank = geometry.index;
          const row = document.createElement("div");
          row.className = "row";
          row.dataset.rank = String(rank);
          row.dataset.id =
            rank === ranks.get("anchor") ? "anchor" : `slot-${rank}`;
          row.dataset.logicalTop = String(geometry.top);
          row.style.top = `${m.toDOMRowTop(geometry.top, port.scrollTop)}px`;
          row.style.height = `${geometry.height}px`;
          row.textContent = row.dataset.id;
          space.append(row);
        }
      }
      port.addEventListener(
        "wheel",
        (event) => {
          if (state.input.wheel(event)) {
            event.preventDefault();
            paint();
          }
        },
        { passive: false },
      );
      port.tabIndex = 0;
      port.addEventListener("scroll", () => {
        if (state.input.fromDOM(port.scrollTop)) paint();
      });
      port.addEventListener("keydown", (event) => {
        if (state.input.key(event.key)) {
          event.preventDefault();
          paint();
        }
      });
      port.addEventListener(
        "touchstart",
        (event) => {
          if (event.touches.length === 1)
            state.input.touchStart(event.touches[0].clientY);
          else state.input.touchEnd();
        },
        { passive: false },
      );
      port.addEventListener(
        "touchmove",
        (event) => {
          if (
            event.touches.length === 1 &&
            state.input.touchMove(event.touches[0].clientY)
          ) {
            event.preventDefault();
            paint();
          } else state.input.touchEnd();
        },
        { passive: false },
      );
      port.addEventListener("touchend", () => state.input.touchEnd());
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
    }, runtimeURL);
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
    await page.locator("#port").focus();
    await page.keyboard.press("PageDown");
    await page.keyboard.press("ArrowUp");
    const keyboard = await page.evaluate(() => probe.read());
    assert.equal(keyboard.scrollTop - wheel.scrollTop, 580);
    const normalized = await page.evaluate(() => {
      const before = probe.mapping.logicalScrollTop;
      const results = [];
      for (const init of [
        { deltaY: 2, deltaMode: 1 },
        { deltaY: 0.5, deltaMode: 2 },
        { deltaY: 0.25, deltaMode: 0 },
        { deltaY: 100, deltaMode: 0, ctrlKey: true },
      ]) {
        const event = new WheelEvent("wheel", {
          ...init,
          bubbles: true,
          cancelable: true,
        });
        probe.port.dispatchEvent(event);
        results.push({
          prevented: event.defaultPrevented,
          scrollTop: probe.mapping.logicalScrollTop,
        });
      }
      return { before, results };
    });
    assert.equal(normalized.results[0].scrollTop - normalized.before, 40);
    assert.equal(normalized.results[1].scrollTop - normalized.before, 340);
    assert.equal(normalized.results[2].scrollTop - normalized.before, 340.25);
    assert.equal(
      normalized.results[3].scrollTop,
      normalized.results[2].scrollTop,
    );
    assert.equal(normalized.results[3].prevented, false);
    let touch = {
      evidence:
        "unavailable: physical-device touch/trackpad inertia not exercised",
    };
    if (name === "chromium") {
      const cdp = await page.context().newCDPSession(page);
      const before = await page.evaluate(() => probe.mapping.logicalScrollTop);
      await cdp.send("Input.dispatchTouchEvent", {
        type: "touchStart",
        touchPoints: [{ x: 200, y: 300 }],
      });
      await cdp.send("Input.dispatchTouchEvent", {
        type: "touchMove",
        touchPoints: [{ x: 200, y: 260 }],
      });
      await cdp.send("Input.dispatchTouchEvent", {
        type: "touchEnd",
        touchPoints: [],
      });
      const after = await page.evaluate(() => probe.read());
      assert.equal(after.scrollTop - before, 40);
      assert(after.rows.some((row) => row.intersects));
      touch = {
        evidence:
          "Chromium protocol-dispatched touch; not physical-device momentum",
        delta: after.scrollTop - before,
      };
      await cdp.detach();
    }
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
      keyboard: compact(keyboard),
      normalized,
      touch,
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
