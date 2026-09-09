import { expect, test, type Locator, type Page } from "@playwright/test";

import { waitForGridReady } from "./helpers";

async function expectAnchored(page: Page, trigger: Locator, overlay: Locator) {
  await expect
    .poll(async () => {
      const anchor = await trigger.boundingBox();
      const popup = await overlay.boundingBox();
      const viewportWidth = await page.evaluate(() => window.innerWidth);
      if (!anchor || !popup) return false;
      const expectedLeft = Math.max(8, Math.min(anchor.x, viewportWidth - 248));
      return (
        Math.abs(popup.x - expectedLeft) < 1 &&
        Math.abs(popup.y - (anchor.y + anchor.height + 4)) < 1
      );
    })
    .toBe(true);
}

test.beforeEach(async ({ page }) => {
  await page.goto("/fixtures/overlay-scope");
  await waitForGridReady(page, '[data-overlay-scope="Morning"]');
  await waitForGridReady(page, '[data-overlay-scope="Evening"]');
});

test("sibling popups dismiss without swallowing outside presses or moving focus back", async ({
  page,
}) => {
  const first = page.getByRole("combobox", {
    name: "Morning first",
    exact: true,
  });
  const second = page.getByRole("combobox", {
    name: "Morning second",
    exact: true,
  });
  await first.click();
  await expect(first).toHaveAttribute("aria-expanded", "true");
  await second.click();
  await expect(first).toHaveAttribute("aria-expanded", "false");
  await expect(second).toHaveAttribute("aria-expanded", "true");
  await expect(page.getByRole("listbox")).toHaveCount(1);
  await second.click();
  await expect(second).toHaveAttribute("aria-expanded", "false");
  await first.click();
  const outside = page.getByRole("button", {
    name: "Outside with stopped bubbling",
  });
  await outside.click();
  await expect(page.getByRole("listbox")).toHaveCount(0);
  await expect(first).not.toBeFocused();
});

test("portal hosts preserve two local token scopes and live direction/theme changes beyond clipping", async ({
  page,
}, testInfo) => {
  for (const [name, background, direction] of [
    ["Morning", "rgb(240, 248, 255)", "ltr"],
    ["Evening", "rgb(17, 34, 51)", "rtl"],
  ] as const) {
    const scope = page.locator(`[data-overlay-scope="${name}"]`);
    const host = scope.locator("[data-overlay-host]");
    const trigger = page.getByRole("combobox", {
      name: `${name} first`,
      exact: true,
    });
    await trigger.click();
    const list = host.getByRole("listbox");
    await expect(list).toBeVisible();
    await expect(list).toHaveCSS("background-color", background);
    await expect(list).toHaveCSS("direction", direction);
    const listBox = await list.boundingBox();
    const clipBox = await scope.locator("[data-scope-clip]").boundingBox();
    expect(listBox).not.toBeNull();
    expect(clipBox).not.toBeNull();
    expect(listBox!.y + listBox!.height).toBeGreaterThan(
      clipBox!.y + clipBox!.height,
    );
    // Keyboard activation models an external live theme update without an
    // outside pointerdown deliberately dismissing the popup first.
    const themeToggle = page.getByRole("button", {
      name: `Toggle ${name} theme`,
      exact: true,
    });
    await themeToggle.focus();
    await themeToggle.press("Enter");
    await expect(list).toHaveCSS(
      "background-color",
      name === "Morning" ? "rgb(17, 34, 51)" : "rgb(240, 248, 255)",
    );
    const directionToggle = page.getByRole("button", {
      name: `Toggle ${name} direction`,
      exact: true,
    });
    await directionToggle.focus();
    await directionToggle.press("Enter");
    await expect(list).toHaveCSS(
      "direction",
      direction === "ltr" ? "rtl" : "ltr",
    );
    await expectAnchored(page, trigger, list);
    await page.screenshot({
      path: testInfo.outputPath(`live-${name}.png`),
      fullPage: true,
    });
    await trigger.press("Escape");
    await expect(list).toHaveCount(0);
  }
});

test("nested filter choices stay in their local host and Escape dismisses one layer", async ({
  page,
}) => {
  const scope = page.locator('[data-overlay-scope="Evening"]');
  const host = scope.locator("[data-overlay-host]");
  const funnel = scope.locator(
    '[data-pretable-filter-funnel][data-pretable-column-id="name"]',
  );
  await funnel.click();
  const dialog = host.locator("[data-pretable-filter-menu]");
  await expect(dialog).toBeVisible();
  const operator = dialog.locator("[data-pretable-filter-operator]");
  await operator.click();
  const list = host.getByRole("listbox");
  await expect(list).toHaveCSS("background-color", "rgb(17, 34, 51)");
  await expect(list).toHaveCSS("direction", "rtl");
  const themeToggle = page.getByRole("button", {
    name: "Toggle Evening theme",
    exact: true,
  });
  await themeToggle.focus();
  await themeToggle.press("Enter");
  await expect(list).toHaveCSS("background-color", "rgb(240, 248, 255)");
  const directionToggle = page.getByRole("button", {
    name: "Toggle Evening direction",
    exact: true,
  });
  await directionToggle.focus();
  await directionToggle.press("Enter");
  await expect(list).toHaveCSS("direction", "ltr");
  await expect(dialog).toBeVisible();
  await expectAnchored(page, funnel, dialog);
  await expectAnchored(page, operator, list);
  await list.locator('[data-pretable-option-value="startsWith"]').click();
  await expect(dialog).toBeVisible();
  await expect(operator).toHaveAttribute("data-pretable-value", "startsWith");
  await operator.click();
  await operator.press("Escape");
  await expect(list).toHaveCount(0);
  await expect(dialog).toBeVisible();
  await expect(operator).toBeFocused();
  await operator.press("Escape");
  await expect(dialog).toHaveCount(0);
});
