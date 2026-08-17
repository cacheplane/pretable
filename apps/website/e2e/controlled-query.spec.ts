import { expect, test } from "@playwright/test";

import {
  openFilterMenu,
  waitForGridReady,
  waitForStablePosition,
} from "./helpers";

/**
 * The controlled-query surfaces on the docs pages: `query` + `onQueryChange`,
 * where the consumer owns the query and the grid reports intent rather than
 * applying it itself. This is the shape a server integration uses, and a manual
 * smoke on 2026-08-14 could not verify either flow here — the filter check
 * opened a non-checklist funnel and toggled nothing, and the collapse check
 * counted rendered rows, which virtualization makes meaningless.
 */
test("checklist funnel filters a controlled grid, and the page sees the query", async ({
  page,
}) => {
  await page.goto("/docs/grid/filtering", { waitUntil: "domcontentloaded" });
  await waitForGridReady(page);

  // The example mounts with `status isAnyOf ["open"]` already applied and
  // echoes it beneath the grid, so this establishes the starting state: the
  // query is the consumer's (ColumnFiltersGrid.tsx's `useState`), not the
  // grid's, and it is rendered. It says nothing yet about `onQueryChange` —
  // at mount the echo only reflects that initial value. What proves the
  // round-trip is the row count and the distinct statuses asserted after the
  // toggle below, since in controlled mode the grid applies nothing and those
  // rows can only have changed by way of the consumer's new query.
  //
  // Re-asserting the echo after the toggle would NOT strengthen this: it
  // prints `${columnId} ${operator}`, and adding `shipped` to the same
  // `isAnyOf` filter leaves the string "status isAnyOf" byte-identical. That
  // assertion would pass whether or not the filter changed.
  //
  // Scoped to the Preview pane because `ExampleShell` keeps the Code pane
  // mounted too (see its layout comment), and the source it renders is
  // `ColumnFiltersGrid.tsx` — which contains the literal "Active filters:"
  // that draws the echo. An unscoped match resolves to both.
  const preview = page.getByRole("tabpanel", { name: "Preview" });
  const echo = preview.getByText(/Active filters:/);
  await expect(echo).toContainText("status");
  const openRows = await page.locator("[data-pretable-row]").count();
  expect(openRows).toBeGreaterThan(0);

  // Scroll the header into place and let the page stop moving BEFORE opening
  // anything. Playwright auto-scrolls a target into view before acting on it,
  // and the docs routes scroll smoothly (`scroll-behavior: smooth`,
  // app/globals.css), so that scroll is still animating when the next action
  // fires. The popover closes on any scroll — deliberately, so it never floats
  // away from its anchor (`overlay/useHeaderPopover.ts`) — so a click issued
  // mid-glide opens the menu and the following animation frame shuts it again.
  // Measured in WebKit: dialog present at t+1260ms, gone at t+1288ms, three
  // runs out of three. Hovering here is what triggers the scroll;
  // `openFilterMenu`'s own hover is then a no-op and its click lands on a still
  // page. `smoke.spec.ts` never needed this because the hero grid sits at the
  // top of the page and is already in view.
  await page.locator("[data-pretable-header-row]").first().hover();
  await waitForStablePosition(
    page.locator(
      '[data-pretable-filter-funnel][data-pretable-column-id="status"]',
    ),
  );

  // `status` is an enum column that declares no `options`, so this checklist is
  // built from the rows' distinct values. All three must be offered.
  const dialog = await openFilterMenu(page, "Status");
  for (const value of ["open", "shipped", "cancelled"]) {
    await expect(dialog.getByRole("checkbox", { name: value })).toBeVisible();
  }

  // Add `shipped` to the selection: strictly more rows, and both values present.
  await dialog.getByRole("checkbox", { name: "shipped" }).check();
  await page.keyboard.press("Escape");

  await expect
    .poll(() => page.locator("[data-pretable-row]").count())
    .toBeGreaterThan(openRows);

  const statuses = await page.$$eval(
    '[data-pretable-row] [data-pretable-column-id="status"]',
    (cells) => [...new Set(cells.map((cell) => cell.textContent?.trim()))],
  );
  expect([...statuses].sort()).toEqual(["open", "shipped"]);
});

test("collapsing a group hides its children, and expanding brings them back", async ({
  page,
}) => {
  await page.goto("/docs/grid/grouping", { waitUntil: "domcontentloaded" });
  await waitForGridReady(page);

  const firstGroup = page.locator("[data-pretable-group-row]").first();
  await expect(firstGroup).toBeVisible();
  await expect(firstGroup).toHaveAttribute("aria-expanded", "true");

  // A NAMED child, not a row count. The grid virtualizes: collapsing a group
  // pulls rows in from below, so `[data-pretable-row]` barely moves and a
  // count-based assertion reports "collapse does nothing" — which is exactly
  // what the 2026-08-14 manual smoke concluded, wrongly.
  //
  // `[data-pretable-row]` alone is already child-rows-only: group rows carry
  // `data-pretable-group-row` and `data-pretable-row-id` but never
  // `data-pretable-row` (packages/react/src/group-row.tsx vs the data-row
  // branch in pretable-surface.tsx), so there is nothing here to exclude.
  const childIds = await page.$$eval("[data-pretable-row]", (rows) =>
    rows
      .map((row) => row.getAttribute("data-pretable-row-id"))
      .filter((id): id is string => id !== null),
  );
  expect(childIds.length).toBeGreaterThan(0);
  // Scoped to `[data-pretable-row]` because group rows DO share the row-id
  // attribute — the ids happen not to collide here (`p1`… vs `__group__:…`),
  // but the locator should not depend on that.
  const child = page.locator(
    `[data-pretable-row][data-pretable-row-id="${childIds[0]}"]`,
  );
  await expect(child).toHaveCount(1);

  // Settle before pressing, for the reason spelled out in the filtering test
  // above: Playwright auto-scrolls the twisty into view, the docs routes scroll
  // smoothly, and the target is 18px wide, so a press issued mid-glide can miss
  // it. Nothing amplifies the miss here the way the filter popover's
  // close-on-scroll does, which is what makes it worth guarding — a click that
  // misses a twisty is silent, and the failure surfaces two assertions later as
  // "collapse did nothing".
  //
  // Prophylactic, not a diagnosed fix: one WebKit run of this test failed once
  // in ~37, on a machine at load average 11, and neither 20 repeat-each runs
  // nor 10 further full-file runs reproduced it — its message was never
  // captured (`reporter: "list"`, no HTML report). This is the most plausible
  // mechanism, not a confirmed one.
  const collapse = firstGroup.getByRole("button", { name: /^Collapse / });
  await collapse.hover();
  await waitForStablePosition(collapse);
  await collapse.click();
  await expect(firstGroup).toHaveAttribute("aria-expanded", "false");
  await expect(child).toHaveCount(0);

  await firstGroup.getByRole("button", { name: /^Expand / }).click();
  await expect(firstGroup).toHaveAttribute("aria-expanded", "true");
  await expect(child).toHaveCount(1);
});
