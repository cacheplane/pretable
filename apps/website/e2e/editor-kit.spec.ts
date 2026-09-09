import { expect, test, type Page } from "@playwright/test";
import { waitForGridReady } from "./helpers";

const cell = (page: Page, column: string) =>
  page.locator(
    `[data-pretable-row-id="a"] [data-pretable-column-id="${column}"]`,
  );
const field = (page: Page) => page.locator(".pretable-cell-editor");
async function edit(page: Page, column: string) {
  await cell(page, column).click();
  await page.keyboard.press("F2");
  await expect(field(page)).toBeFocused();
}
async function rows(page: Page) {
  return JSON.parse(await page.locator("[data-saved-rows]").innerText());
}
test.beforeEach(async ({ page }) => {
  await page.goto("/fixtures/editor-kit");
  await waitForGridReady(page);
});

test("duplicate enum identity survives pristine commit, explicit choice, ambiguity and clearing", async ({
  page,
}) => {
  await edit(page, "status");
  await field(page).press("Enter");
  await expect(field(page)).toHaveCount(0);
  expect((await rows(page))[0].status).toBe("b");
  await edit(page, "status");
  await page.locator('[data-pretable-option-value="a"]').click();
  await expect(field(page)).toHaveCount(0);
  expect((await rows(page))[0].status).toBe("a");
  await edit(page, "status");
  await page.locator('[data-pretable-option-value="b"]').click();
  await expect(field(page)).toHaveCount(0);
  expect((await rows(page))[0].status).toBe("b");
  await edit(page, "status");
  await field(page).fill("");
  await field(page).fill("Same");
  await field(page).press("Enter");
  await expect(field(page)).toHaveAttribute("aria-invalid", "true");
  expect((await rows(page))[0].status).toBe("b");
  await field(page).fill("");
  await field(page).press("Enter");
  await expect(field(page)).toHaveCount(0);
  expect((await rows(page))[0].status).toBeNull();
  await edit(page, "status");
  await field(page).fill("");
  await field(page).press("ArrowDown");
  await page.getByRole("button", { name: "Outside editor" }).click();
  await expect(field(page)).toHaveCount(0);
  expect((await rows(page))[0].status).toBe("b");
});

test("reverse commit navigation and multiline native behavior survive component replacement", async ({
  page,
}) => {
  await edit(page, "quantity");
  await expect(field(page)).toHaveAttribute("data-fixture-input", "");
  await expect(
    page.getByRole("button", { name: "Increment", exact: true }),
  ).toHaveAttribute("data-fixture-icon-button", "");
  await field(page).fill("7");
  await field(page).press("Shift+Tab");
  await expect(field(page)).toHaveCount(0);
  expect((await rows(page))[0].quantity).toBe(7);
  await expect(cell(page, "name")).toHaveAttribute(
    "data-pretable-focused",
    "true",
  );
  await edit(page, "notes");
  await expect(field(page)).toHaveAttribute("data-fixture-textarea", "");
  await field(page).fill("One");
  await field(page).press("End");
  await field(page).press("Enter");
  await page.keyboard.type("Two");
  await expect(field(page)).toHaveValue("One\nTwo");
  await field(page).press("Control+Enter");
  await expect(field(page)).toHaveCount(0);
  expect((await rows(page))[0].notes).toBe("One\nTwo");
});

test("composition retains native keys and never starts or commits grid editing", async ({
  page,
}) => {
  await cell(page, "name").click();
  await cell(page, "name").dispatchEvent("keydown", {
    key: "Enter",
    isComposing: true,
    keyCode: 229,
  });
  await expect(field(page)).toHaveCount(0);
  await edit(page, "quantity");
  const result = await field(page).evaluate((el) => {
    el.dispatchEvent(
      new CompositionEvent("compositionstart", { bubbles: true }),
    );
    let consumed = false;
    for (const key of ["Enter", "Escape", "ArrowUp", "Tab"]) {
      const e = new KeyboardEvent("keydown", {
        key,
        bubbles: true,
        cancelable: true,
        isComposing: true,
      });
      el.dispatchEvent(e);
      consumed ||= e.defaultPrevented;
    }
    el.dispatchEvent(new CompositionEvent("compositionend", { bubbles: true }));
    return consumed;
  });
  expect(result).toBe(false);
  await expect(field(page)).toHaveValue("2");
  await expect(page.locator("[data-saved-count]")).toHaveText("0");
  await field(page).press("Escape");
  await expect(field(page)).toHaveCount(0);
});

test("calendar browsing preserves the draft until an explicit choice and exposes a grid combobox", async ({
  page,
}) => {
  await edit(page, "date");
  await expect(field(page)).toHaveAttribute("role", "combobox");
  await expect(field(page)).toHaveAttribute("aria-haspopup", "grid");
  await field(page).press("PageDown");
  await expect(field(page)).toHaveValue("2026-08-18");
  await page.getByRole("button", { name: "Outside editor" }).click();
  await expect(field(page)).toHaveCount(0);
  expect((await rows(page))[0].date).toBe("2026-08-18");
  await edit(page, "date");
  await page.getByRole("button", { name: "Next month", exact: true }).click();
  await expect(field(page)).toHaveValue("2026-08-18");
  await page.getByRole("gridcell", { name: "2026-09-18", exact: true }).click();
  await expect(field(page)).toHaveCount(0);
  expect((await rows(page))[0].date).toBe("2026-09-18");
  await edit(page, "date");
  await field(page).fill("   ");
  await page.getByRole("button", { name: "Outside editor" }).click();
  await expect(field(page)).toHaveCount(0);
  expect((await rows(page))[0].date).toBeNull();
  await edit(page, "date");
  await field(page).fill("");
  await field(page).press("Tab");
  await expect(field(page)).toHaveCount(0);
  expect((await rows(page))[0].date).toBeNull();
});

test("focused validation errors preserve usable width and error outline", async ({
  page,
}, info) => {
  await edit(page, "quantity");
  await field(page).fill("-1");
  await field(page).press("Enter");
  await expect(field(page)).toHaveAttribute("aria-invalid", "true");
  await expect(page.locator("[data-pretable-edit-error]")).toHaveAttribute(
    "title",
    "Use a positive quantity",
  );
  const style = await field(page).evaluate((el) => ({
    width: el.getBoundingClientRect().width,
    outline: getComputedStyle(el).outlineColor,
    error: getComputedStyle(el)
      .getPropertyValue("--pretable-text-error")
      .trim(),
  }));
  expect(style.width).toBeGreaterThan(110);
  await expect(field(page)).toHaveCSS(
    "outline-color",
    await field(page).evaluate((el) => {
      const probe = document.createElement("span");
      probe.style.color = "var(--pretable-text-error)";
      el.parentElement!.append(probe);
      const color = getComputedStyle(probe).color;
      probe.remove();
      return color;
    }),
  );
  await page.screenshot({ path: info.outputPath("number-error.png") });
  await field(page).press("Escape");
  await edit(page, "date");
  await field(page).press("ArrowDown");
  await expect(page.locator("[data-pretable-date-active]")).toHaveCount(1);
  await page.screenshot({ path: info.outputPath("date-active.png") });
  if (info.project.name === "chromium") {
    await page.emulateMedia({ forcedColors: "active" });
    await expect(page.locator("[data-pretable-date-active]")).toHaveCSS(
      "outline-style",
      "solid",
    );
    await page.screenshot({ path: info.outputPath("date-forced.png") });
  }
});

test("compact errors leave room for readable field text", async ({ page }) => {
  await page.getByRole("button", { name: "Toggle compact" }).click();
  await waitForGridReady(page);
  await edit(page, "quantity");
  await field(page).fill("-1");
  await field(page).press("Enter");
  await expect(field(page)).toHaveAttribute("aria-invalid", "true");
  const dimensions = await field(page).evaluate((el) => {
    const style = getComputedStyle(el);
    return {
      content:
        el.getBoundingClientRect().height -
        parseFloat(style.paddingTop) -
        parseFloat(style.paddingBottom),
      font: parseFloat(style.fontSize),
    };
  });
  expect(dimensions.content).toBeGreaterThanOrEqual(dimensions.font);
});

test("documentation date editor leaves room for the complete ISO date", async ({
  page,
}) => {
  await page.goto("/docs/grid/editing");
  const example = page.locator("figure").first();
  await example.scrollIntoViewIfNeeded();
  await example
    .locator(
      '[data-pretable-row-id="s1"] [data-pretable-column-id="restockBy"]',
    )
    .click();
  await page.keyboard.press("F2");
  await expect(field(page)).toBeFocused();
  const size = await field(page).evaluate((el) => {
    const style = getComputedStyle(el);
    const context = document.createElement("canvas").getContext("2d")!;
    context.font = `${style.fontStyle} ${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
    return {
      text: context.measureText((el as HTMLInputElement).value).width,
      space:
        el.clientWidth -
        parseFloat(style.paddingLeft) -
        parseFloat(style.paddingRight),
    };
  });
  expect(size.space).toBeGreaterThanOrEqual(size.text);
});
