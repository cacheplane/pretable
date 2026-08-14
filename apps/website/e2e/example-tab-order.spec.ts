import { expect, test, type Page } from "@playwright/test";

import { waitForGridReady } from "./helpers";

/**
 * Keyboard reachability of an `<Example>`'s controls, driven with real Tab
 * presses in a real engine.
 *
 * This cannot be tested in jsdom. Safari's default is that native `<button>`
 * and `<a>` elements are NOT in the sequential focus order unless the user has
 * turned on Full Keyboard Access — they still accept focus programmatically
 * and still respond to `.click()`, so every jsdom assertion and every
 * Playwright `click()` in the rest of this suite passes while a Safari reader
 * cannot reach the control at all. The only thing that discriminates is
 * pressing Tab and reading `document.activeElement`, which is what this file
 * does, in both `webkit` and `chromium`.
 *
 * Before the explicit `tabIndex={0}` on ExampleShell's action controls, the
 * WebKit sequence below was three stops long — Code tab, file tab, code
 * region — with Expand, Copy file, Copy for agent and the .md link skipped
 * outright.
 */

const DOCS_URL = "/docs/grid/grouping";

/**
 * Scoped by position, matching `example-component.spec.ts`: docs pages carry
 * several examples, and only the first one's demo is mounted (demos mount
 * lazily on "in view AND selected"). `grouping-panel` is also the example
 * that exercises every control at once — it has a demo (so there are two view
 * tabs), three files (so there is a file-tab strip), and a source long enough
 * to overflow the pane (so Expand renders).
 */
const exampleFigure = (page: Page) =>
  page
    .locator("figure", {
      has: page.getByRole("tablist", { name: "Example view" }),
    })
    .first();

interface Stop {
  /** `role:name`-ish descriptor — stable across engines, readable in a diff. */
  label: string;
  /** id of the enclosing `[role=tabpanel]`, or "" when outside both panes. */
  pane: string;
}

/**
 * Describe whatever currently holds focus. Runs in the page so it reads the
 * engine's real `document.activeElement` rather than Playwright's idea of it.
 */
function activeStop(page: Page): Promise<Stop> {
  return page.evaluate(() => {
    const el = document.activeElement as HTMLElement | null;
    if (!el || el === document.body) return { label: "<body>", pane: "" };
    const pane = el.closest("[role=tabpanel]")?.id ?? "";
    // Shiki emits the highlighted source as a `<pre tabindex="0">`; that is
    // the scrollable code region, and it is the one stop here that is not a
    // control.
    if (el.tagName === "PRE") return { label: "code region", pane };
    const name = (el.getAttribute("aria-label") ?? el.textContent ?? "").trim();
    const role = el.getAttribute("role") ?? "";
    const kind = role !== "" ? role : el.tagName === "A" ? "link" : "button";
    return { label: `${kind}:${name}`, pane };
  });
}

/** Press Tab `count` times, describing focus after each press. */
async function walk(page: Page, count: number): Promise<Stop[]> {
  const stops: Stop[] = [];
  for (let i = 0; i < count; i++) {
    await page.keyboard.press("Tab");
    stops.push(await activeStop(page));
  }
  return stops;
}

async function paneIds(page: Page) {
  const figure = exampleFigure(page);
  const previewPane = await figure
    .getByRole("tab", { name: "Preview" })
    .getAttribute("aria-controls");
  const codePane = await figure
    .getByRole("tab", { name: "Code" })
    .getAttribute("aria-controls");
  if (!previewPane || !codePane) {
    throw new Error("Expected both view tabs to carry aria-controls");
  }
  return { previewPane, codePane };
}

test("Tab reaches every example control in reading order, Code view", async ({
  page,
}) => {
  await page.goto(DOCS_URL, { waitUntil: "domcontentloaded" });
  await waitForGridReady(page);

  const { previewPane } = await paneIds(page);
  const figure = exampleFigure(page);
  const codeTab = figure.getByRole("tab", { name: "Code" });

  // Activating a tab moves focus to it (APG, and `selectView` does it
  // explicitly because Safari does not focus a clicked button). That gives
  // the walk below a deterministic starting point inside the figure.
  await codeTab.click();
  await expect(codeTab).toHaveAttribute("aria-selected", "true");
  expect(await activeStop(page)).toMatchObject({ label: "tab:Code" });

  const stops = await walk(page, 7);

  // Reading order, which is also DOM order: the header row runs
  // `[Preview][Code] … [N lines][Expand] … [Copy file][Copy for agent][.md]`
  // left to right, the file-tab strip is the row under it, and the code is
  // below that. Note this is NOT "actions last" — the actions sit in the same
  // bar as the view tabs, above the file tabs, and the tab order follows what
  // the eye follows.
  //
  // Only the SELECTED tab of each tablist appears: both tablists are roving
  // (unselected tabs are `tabindex="-1"`, arrow keys move between them), and
  // giving those tabs `tabindex="0"` would have put all five in the tab order
  // and defeated the pattern.
  expect(stops.map((s) => s.label)).toEqual([
    "button:Expand",
    "button:Copy file",
    "button:Copy for agent",
    "link:.md",
    "tab:GroupingPanelGrid.tsx",
    "code region",
    // The first fenced code block after the example, proving CodeSurface's
    // own Copy — the fence variant of the same surface — is reachable too.
    "button:Copy code",
  ]);

  // The inactive pane is kept mounted and marked `inert` (see the block
  // comment in ExampleShell.tsx). Its contents include a grouping chip with
  // an explicit `tabindex="0"`, so it is genuinely tabbable on its own and
  // `inert` is the only thing holding it out of this walk.
  expect(stops.filter((s) => s.pane === previewPane)).toEqual([]);
});

test("Tab reaches every example control in reading order, Preview view", async ({
  page,
}) => {
  await page.goto(DOCS_URL, { waitUntil: "domcontentloaded" });
  await waitForGridReady(page);

  const { codePane, previewPane } = await paneIds(page);
  const figure = exampleFigure(page);
  const previewTab = figure.getByRole("tab", { name: "Preview" });

  await expect(previewTab).toHaveAttribute("aria-selected", "true");
  await previewTab.focus();
  expect(await activeStop(page)).toMatchObject({ label: "tab:Preview" });

  const stops = await walk(page, 2);

  // Expand and Copy file are Code-view-only controls, so the Preview view's
  // action row is just these two.
  expect(stops.map((s) => s.label)).toEqual([
    "button:Copy for agent",
    "link:.md",
  ]);

  // Focus then descends into the live demo. Asserted by pane rather than by
  // name: the first tabbable thing in there is a grouping chip owned by
  // @pretable/react, not by this component. What matters here is that it is
  // the PREVIEW pane's content and never the `inert` code pane's — whose
  // `<pre tabindex="0">` sits earlier in the DOM and would otherwise be the
  // next stop.
  const next = (await walk(page, 1))[0];
  expect(next.pane).toBe(previewPane);
  expect([...stops, next].filter((s) => s.pane === codePane)).toEqual([]);
});
