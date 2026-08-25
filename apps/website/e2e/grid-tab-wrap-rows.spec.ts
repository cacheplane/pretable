import { expect, test, type Page } from "@playwright/test";

import { waitForGridReady } from "./helpers";

/**
 * `tabBehavior="wrap-rows"` is not a keyboard trap — driven with real Tab
 * presses, in both engines. WCAG 2.1.2 regression guard.
 *
 * This configuration was a trap: it consumed Tab and Shift+Tab unconditionally
 * and clamped at the two corners, so 120 consecutive presses never left the
 * grid in either engine, and no key could get focus back out of the page. The
 * fix was to RELEASE at the corners instead of clamping, and this file is the
 * only place that claim is checked against a browser's own sequential focus
 * order.
 *
 * It cannot be checked anywhere else. jsdom has no sequential focus order at
 * all — `Tab` there is an ordinary keydown and nothing traverses unless a
 * handler moves it by hand — so `packages/react/src/__tests__/
 * tab-behavior.test.tsx` can only ask which presses the surface calls
 * `preventDefault()` on. "The grid did not consume the press" and "focus left
 * the grid" are different statements, and only the second is the absence of a
 * trap. And no page on the docs site renders a `wrap-rows` grid, which is why
 * this drives `/fixtures/tab-wrap-rows` instead.
 *
 * Every count below is EXACT, not a ceiling. A trap regression re-clamps at a
 * corner, and a generous `toBeLessThan` bound would be satisfied by a walk
 * that spent its slack looping — the number is the assertion.
 *
 * Since the tool panel (tool-panel SP1, 2026-08-24) the surface renders a rail
 * of section tabs after the grid, on by default, and the rail is deliberately
 * ONE stop in the sequential order — a roving tablist, closed pane, no pane
 * controls in this fixture. A forward release therefore lands on the rail tab
 * first, and exactly one more press reaches the document. The forward walks
 * below name that stop explicitly rather than absorbing it into a count, so a
 * rail that grows a second stop — or becomes a trap — fails here loudly.
 * Backward exits never meet the rail: it sits between the grid and
 * `#after-grid`, not before the grid.
 */

const FIXTURE = "/fixtures/tab-wrap-rows";

/** The fixture's shape. A wrap-rows exit costs at most this many presses. */
const ROWS = 4;
const COLUMNS = 3;
const CELLS = ROWS * COLUMNS;

/**
 * Well past any legitimate count on a 3 x 4 grid, so a clamped corner shows up
 * as `null` rather than as a timeout, and the failure message can say how far
 * the walk actually got.
 */
const LIMIT = 40;

/**
 * Where DOM focus is, as one string.
 *
 * Naming the landing element is not decoration: a tab walk WRAPS THE DOCUMENT.
 * WebKit laps a page several times in 30 presses, so a counter that only asks
 * "outside the grid yet?" cannot tell a one-press release from a full lap back
 * around to the same place. The fixture's two text inputs bracket the grid so
 * that a forward release and a backward one are distinguishable, and `"NONE"`
 * (`<body>` or nothing) marks the browser-chrome step of a lap.
 */
function focusLocation(page: Page): Promise<string> {
  return page.evaluate(() => {
    const active = document.activeElement;
    // `null` and `<body>` both mean "no focus owner". Spelling this as
    // `active?.closest(...) != null` inverts it — optional chaining yields
    // `undefined`, which is not `null` — and a walk parked on `<body>` would
    // then report itself as still inside the grid forever.
    if (active === null || active === document.body) return "NONE";
    // Before the id branch: the rail tab carries a React-generated id, and the
    // walks reason about it by ROLE, not by that unstable string.
    if (active.closest("[data-pretable-tool-tab]") !== null) return "rail:tab";
    if (active.id !== "") return `#${active.id}`;
    const cell = active.closest("[data-pretable-cell]");
    if (cell !== null) {
      const rowId = cell
        .closest("[data-pretable-row]")
        ?.getAttribute("data-pretable-row-id");
      return `cell:${rowId},${cell.getAttribute("data-pretable-column-id")}`;
    }
    const header = active.closest("[data-pretable-header-cell]");
    if (header !== null) {
      return `header:${header.getAttribute("data-pretable-column-id")}`;
    }
    const inGrid = active.closest("[data-pretable-scroll-viewport]") !== null;
    return `${inGrid ? "ingrid" : "outside"}:${active.tagName.toLowerCase()}`;
  });
}

function isInGrid(location: string): boolean {
  return location.startsWith("cell:") || location.startsWith("header:");
}

/**
 * Press `key` until focus is out of the grid, returning the press count and the
 * element it landed on, plus the trace for the failure message.
 */
async function walkOut(page: Page, key: string) {
  const trace: string[] = [];
  for (let i = 1; i <= LIMIT; i++) {
    await page.keyboard.press(key);
    const at = await focusLocation(page);
    trace.push(at);
    if (!isInGrid(at)) return { presses: i, landedOn: at, trace };
  }
  return { presses: null, landedOn: null, trace };
}

/**
 * Enter the grid the way a keyboard user does, and assert where that lands.
 *
 * Focus is established by KEYBOARD, never by a click, and that is load-bearing
 * rather than tidy. Safari does not treat a mouse-or-programmatic focus as the
 * sequential-navigation starting point, so a backward-exit test that started
 * from a CLICKED cell measured stuck-for-120-presses in WebKit on a grid that
 * releases in one press from the same cell reached by Tab. A keyboard-only
 * user's trap is also the honest scenario for a keyboard-trap test.
 */
async function enterGrid(page: Page) {
  await page.goto(FIXTURE, { waitUntil: "domcontentloaded" });
  await waitForGridReady(page);
  await page.locator("#before-grid").focus();
  await page.keyboard.press("Tab");
  // One press from outside puts the cursor on the top-left cell: the grid is a
  // single tab stop, and an untouched grid hands the first press its entry
  // cell. Every count below is measured from here, so it is asserted rather
  // than assumed.
  expect(await focusLocation(page)).toBe("cell:r1,alpha");
}

/** Move the cursor with the ARROW keys, which never leave the grid. */
async function arrowTo(page: Page, moves: string[]) {
  for (const move of moves) await page.keyboard.press(move);
}

/**
 * A forward release's second half: focus is on the rail tab, and exactly ONE
 * more press reaches the document. Asserted as a step, not folded into a
 * count, so a rail that gained a second tab stop fails on the landing element
 * — the extra press would land `rail:tab` again, never `#after-grid`.
 */
async function assertOnePressPastRail(page: Page) {
  await page.keyboard.press("Tab");
  expect(await focusLocation(page)).toBe("#after-grid");
}

test.describe("wrap-rows exit — WCAG 2.1.2 No Keyboard Trap", () => {
  test("Tab walks to the bottom-right corner and releases, in exactly rows x columns presses", async ({
    page,
  }) => {
    await enterGrid(page);

    const { presses, landedOn, trace } = await walkOut(page, "Tab");

    // The worst case for this configuration, and the number the docs quote:
    // from the top-left cell, forward release costs rows x columns presses —
    // 11 to walk the 12 cells, and a 12th that the grid hands back to the
    // browser, landing on the rail's designed stop. Anything more is a clamp;
    // anything less means the walk skipped cells.
    expect({ presses, landedOn }).toEqual({
      presses: CELLS,
      landedOn: "rail:tab",
    });
    await assertOnePressPastRail(page);

    // The positive twin: a wrap-rows that released EVERYWHERE — i.e. did
    // nothing at all — would leave the grid on press 1 and is the opposite
    // failure. The walk has to actually wrap a row boundary.
    expect(trace.slice(0, 3)).toEqual([
      "cell:r1,bravo",
      "cell:r1,charlie",
      "cell:r2,alpha",
    ]);
  });

  test("Shift+Tab releases at the top-left corner in one press", async ({
    page,
  }) => {
    await enterGrid(page);

    const { presses, landedOn } = await walkOut(page, "Shift+Tab");

    // The entry cell IS the top-left corner, so there is no walk to do: the
    // grid hands the very first press back. This is the corner that used to
    // clamp — Shift+Tab sat on the first cell forever, consumed but doing
    // nothing, with no key that could get focus out of the page.
    expect({ presses, landedOn }).toEqual({
      presses: 1,
      landedOn: "#before-grid",
    });
  });

  test("Shift+Tab from mid-grid walks back to the first cell and releases", async ({
    page,
  }) => {
    await enterGrid(page);
    // (r3, charlie) — row index 2, column index 2, so a backward release is 8
    // walk presses plus the release.
    await arrowTo(page, ["ArrowDown", "ArrowDown", "End"]);
    expect(await focusLocation(page)).toBe("cell:r3,charlie");

    const { presses, landedOn } = await walkOut(page, "Shift+Tab");

    expect({ presses, landedOn }).toEqual({
      presses: 2 * COLUMNS + 2 + 1,
      landedOn: "#before-grid",
    });
  });

  test("Tab from mid-grid walks forward to the last cell and releases", async ({
    page,
  }) => {
    await enterGrid(page);
    await arrowTo(page, ["ArrowDown", "ArrowRight"]);
    expect(await focusLocation(page)).toBe("cell:r2,bravo");

    const { presses, landedOn } = await walkOut(page, "Tab");

    // From (row index 1, column index 1): two rows of remaining cells and one
    // more in this row, then the release onto the rail stop.
    expect({ presses, landedOn }).toEqual({
      presses: 2 * COLUMNS + 1 + 1,
      landedOn: "rail:tab",
    });
    await assertOnePressPastRail(page);
  });
});

test.describe("wrap-rows exit — from the column header", () => {
  // Both ends of the header, because the release is meant to be independent of
  // where in the header the cursor is: the surface hands Tab back on a header
  // cell before it ever looks at the column index. The last column is the one
  // that would betray a walk — under the body's rule a last-column Tab wraps
  // to the next row rather than releasing.
  for (const [column, arrows] of [
    ["alpha", ["ArrowUp"]],
    ["charlie", ["End", "ArrowUp"]],
  ] as const) {
    test(`Tab leaves in one press from the ${column} header`, async ({
      page,
    }) => {
      await enterGrid(page);
      await arrowTo(page, [...arrows]);
      expect(await focusLocation(page)).toBe(`header:${column}`);

      const { presses, landedOn } = await walkOut(page, "Tab");
      expect({ presses, landedOn }).toEqual({
        presses: 1,
        landedOn: "rail:tab",
      });
      await assertOnePressPastRail(page);
    });

    test(`Shift+Tab leaves in one press from the ${column} header`, async ({
      page,
    }) => {
      await enterGrid(page);
      await arrowTo(page, [...arrows]);
      expect(await focusLocation(page)).toBe(`header:${column}`);

      const { presses, landedOn } = await walkOut(page, "Shift+Tab");
      expect({ presses, landedOn }).toEqual({
        presses: 1,
        landedOn: "#before-grid",
      });
    });
  }
});

test.describe("wrap-rows round trip", () => {
  test("Shift+Tab back in restores the cell the walk released from", async ({
    page,
  }) => {
    await enterGrid(page);
    await arrowTo(page, ["ArrowDown", "ArrowRight"]);

    const { landedOn } = await walkOut(page, "Tab");
    expect(landedOn).toBe("rail:tab");
    await assertOnePressPastRail(page);

    // The mirror of the forward exit: one Shift+Tab from the document lands
    // the rail's single stop, and the next enters the grid — the pane is
    // closed in this fixture, so nothing else intervenes.
    await page.keyboard.press("Shift+Tab");
    expect(await focusLocation(page)).toBe("rail:tab");

    await page.keyboard.press("Shift+Tab");
    // The grid remembers where it LEFT — the bottom-right corner it released
    // from — not the cell the walk started at. Under `wrap-rows` those are
    // different cells, which is the whole difference from the default.
    expect(await focusLocation(page)).toBe("cell:r4,charlie");
  });
});
