import { expect, type Page } from "@playwright/test";

/**
 * Open the hero drawer via its bottom handle, and wait for it to actually open.
 *
 * The handle is server-rendered, so it paints — and Playwright considers it
 * visible and clickable — before React has hydrated it. Its `onClick` does not
 * exist yet at that point, so the click is accepted by the browser and silently
 * dropped; the test then fails further down with an unrelated-looking symptom.
 *
 * Neither obvious signal discriminates, because both are in the SSR markup:
 * `<html data-drawer="closed">` is written by `layout.tsx` (the drawer CSS is
 * gated on the attribute, so it has to be there pre-hydration to avoid a flash
 * of the whole drawer), and `[data-pretable-scroll-viewport]` ships in the
 * prerendered HTML too. Both are already present while the click is still dead.
 *
 * `data-hydrated` is written by `DrawerHandle` from `useDrawer`'s `isUpgraded`
 * flag, which flips in a post-hydration effect — the same effect run that
 * attaches `onClick`. It is therefore the one signal that means "this control
 * is live", so wait on it rather than retrying the click until it happens to
 * land.
 */
export async function openDrawer(page: Page): Promise<void> {
  const handle = page.getByTestId("drawer-handle");
  // Generous: hydration is quick locally but slow on a cold preview deploy.
  await expect(handle).toHaveAttribute("data-hydrated", "true", {
    timeout: 20_000,
  });
  await handle.click();
  await expect(page.locator("html")).toHaveAttribute("data-drawer", "open");
}
