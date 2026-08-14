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
