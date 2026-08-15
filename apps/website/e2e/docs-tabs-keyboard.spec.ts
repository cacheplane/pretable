import { expect, test, type Locator, type Page } from "@playwright/test";

import { waitForDocsReady } from "./helpers";

/**
 * Keyboard behaviour of the MDX `<Tabs>` strip, driven with real key presses
 * in both engines.
 *
 * Same reasoning as `example-tab-order.spec.ts`, which covers `ExampleShell`'s
 * two tablists: jsdom cannot see any of this. Safari keeps native `<button>`s
 * out of the sequential focus order unless the reader has turned on Full
 * Keyboard Access, so a tab with no explicit `tabindex` is unreachable there
 * while every `fireEvent.click` and every Playwright `click()` still passes.
 * The only thing that discriminates is pressing Tab and reading
 * `document.activeElement`.
 *
 * Before the fix this strip had no `tabindex` and no key handler at all, so it
 * was unreachable in WebKit and — worse than useless in Chromium — one tab
 * stop per tab, which is not the APG tabs pattern.
 *
 * `/docs/streaming` is the only page that uses `<Tabs>`.
 */

const TABS_URL = "/docs/streaming";
const FIRST_TAB = "Element streams";
const SECOND_TAB = "Partial streams";

/**
 * By role, not by name alone: the docs sidebar carries links reading
 * "Element streams" and "Partial streams" too, and only these are `role=tab`.
 */
const tab = (page: Page, name: string) => page.getByRole("tab", { name });

/**
 * This page also carries two `<Example>`s, each with its own tablist, so
 * scope by the strip that holds these tabs rather than by role alone.
 */
const tablist = (page: Page) =>
  page.getByRole("tablist").filter({ has: tab(page, FIRST_TAB) });

/**
 * The single panel both tabs drive.
 *
 * Located structurally — the `[role=tabpanel]` sibling of this strip — rather
 * than by following the tabs' `aria-controls`. That matters: `aria-controls`
 * is itself part of the fix under test, so resolving the panel through it
 * would make every test here fail on the wiring before it ever pressed a key,
 * and the keyboard assertions would never be the thing that reported.
 */
const tabsPanel = (page: Page): Locator =>
  tablist(page).locator("xpath=following-sibling::*[@role='tabpanel']");

/**
 * Describe whatever holds focus, evaluated in the page so it reads the
 * engine's real `document.activeElement` rather than Playwright's idea of it.
 */
function activeStop(page: Page): Promise<string> {
  return page.evaluate(() => {
    const el = document.activeElement as HTMLElement | null;
    if (!el || el === document.body) return "<body>";
    const name = (el.getAttribute("aria-label") ?? el.textContent ?? "").trim();
    const role = el.getAttribute("role") ?? "";
    const kind = role !== "" ? role : el.tagName.toLowerCase();
    return `${kind}:${name}`;
  });
}

/** `tabIndex` of each tab in the strip, in DOM order. */
function tabIndexes(page: Page): Promise<number[]> {
  return tablist(page)
    .getByRole("tab")
    .evaluateAll((els) => els.map((el) => (el as HTMLElement).tabIndex));
}

async function openTabsPage(page: Page) {
  await page.goto(TABS_URL, { waitUntil: "domcontentloaded" });
  await waitForDocsReady(page);
  await expect(tab(page, FIRST_TAB)).toBeVisible();
}

test("Tabs renders its tabs and the selected tab's body", async ({ page }) => {
  await openTabsPage(page);

  // The regression this guards is not cosmetic: `<Tabs>` matched its children
  // with `child.type === Tab`, which is always false across the RSC boundary
  // (the docs MDX compiles in a server component, so `Tab` there is a client
  // *reference*, not this module's function). The whole "Pick the connector"
  // section — both connector snippets — was missing from the built page, and
  // no test in jsdom could see it because jsdom has no such boundary.
  await expect(tab(page, FIRST_TAB)).toHaveAttribute("aria-selected", "true");
  await expect(tab(page, SECOND_TAB)).toHaveAttribute("aria-selected", "false");

  const panel = tabsPanel(page);
  await expect(panel).toContainText("connectElementStream");
  await expect(panel).not.toContainText("connectPartialStream");
});

test("each tab is wired to the panel it controls", async ({ page }) => {
  await openTabsPage(page);
  const panelId = await tabsPanel(page).getAttribute("id");
  expect(panelId).toBeTruthy();
  for (const name of [FIRST_TAB, SECOND_TAB]) {
    await expect(tab(page, name)).toHaveAttribute("aria-controls", panelId!);
  }
  const selectedId = await tab(page, FIRST_TAB).getAttribute("id");
  await expect(tabsPanel(page)).toHaveAttribute("aria-labelledby", selectedId!);
});

test("the tablist is a single tab stop, and Tab reaches it", async ({
  page,
}) => {
  await openTabsPage(page);
  const panel = tabsPanel(page);

  // Anchor inside the panel and walk backwards out of it. Focusing the anchor
  // programmatically works in every engine (Safari's restriction is on the
  // sequential order, not on focusability), so the Shift+Tab presses that
  // follow are what is actually under test.
  const anchor = panel.getByRole("button", { name: /copy/i }).first();
  await anchor.focus();

  // One press back out of the panel lands on the SELECTED tab. In WebKit,
  // before the fix, it skipped the strip entirely; in Chromium it landed on
  // the last tab, because every tab was its own stop.
  await page.keyboard.press("Shift+Tab");
  expect(await activeStop(page)).toBe(`tab:${FIRST_TAB}`);

  // A second press leaves the strip altogether rather than stepping onto the
  // other tab — one stop for the whole tablist, which is the pattern.
  await page.keyboard.press("Shift+Tab");
  expect(await activeStop(page)).not.toBe(`tab:${SECOND_TAB}`);

  // And the same going forwards: from the selected tab, Tab exits the strip.
  await tab(page, FIRST_TAB).focus();
  await page.keyboard.press("Tab");
  expect(await activeStop(page)).not.toBe(`tab:${SECOND_TAB}`);
});

test("arrow keys move between tabs and Home/End jump to the ends", async ({
  page,
}) => {
  await openTabsPage(page);
  const first = tab(page, FIRST_TAB);
  const second = tab(page, SECOND_TAB);
  const panel = tabsPanel(page);

  await first.focus();
  expect(await tabIndexes(page)).toEqual([0, -1]);

  // Right moves selection, focus and the roving 0 together, and swaps the
  // panel's body — selection follows focus, per the APG pattern.
  await page.keyboard.press("ArrowRight");
  await expect(second).toHaveAttribute("aria-selected", "true");
  expect(await activeStop(page)).toBe(`tab:${SECOND_TAB}`);
  expect(await tabIndexes(page)).toEqual([-1, 0]);
  await expect(panel).toContainText("connectPartialStream");

  // Left goes back.
  await page.keyboard.press("ArrowLeft");
  await expect(first).toHaveAttribute("aria-selected", "true");
  expect(await activeStop(page)).toBe(`tab:${FIRST_TAB}`);
  expect(await tabIndexes(page)).toEqual([0, -1]);

  // Left off the first tab wraps to the last rather than dead-ending.
  await page.keyboard.press("ArrowLeft");
  await expect(second).toHaveAttribute("aria-selected", "true");
  expect(await tabIndexes(page)).toEqual([-1, 0]);

  // Right off the last wraps back to the first.
  await page.keyboard.press("ArrowRight");
  await expect(first).toHaveAttribute("aria-selected", "true");

  // End/Home jump to the ends. With two tabs these coincide with the arrows,
  // so assert the tabIndex ledger too — that is what distinguishes a handled
  // key from an unhandled one that happened to leave focus where it was.
  await page.keyboard.press("End");
  await expect(second).toHaveAttribute("aria-selected", "true");
  expect(await activeStop(page)).toBe(`tab:${SECOND_TAB}`);
  expect(await tabIndexes(page)).toEqual([-1, 0]);

  await page.keyboard.press("Home");
  await expect(first).toHaveAttribute("aria-selected", "true");
  expect(await activeStop(page)).toBe(`tab:${FIRST_TAB}`);
  expect(await tabIndexes(page)).toEqual([0, -1]);
});
