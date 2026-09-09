import { expect, test, type Locator } from "@playwright/test";

async function expectFeedbackInsideCell(feedback: Locator) {
  const bounds = await feedback.evaluate((element) => {
    const cell = element.closest("[data-pretable-column-id]")!;
    const outer = cell.getBoundingClientRect();
    const range = document.createRange();
    range.selectNodeContents(element);
    const text = range.getBoundingClientRect();
    return {
      fits:
        text.left >= outer.left &&
        text.right <= outer.right &&
        text.top >= outer.top &&
        text.bottom <= outer.bottom,
      text: {
        left: text.left,
        right: text.right,
        top: text.top,
        bottom: text.bottom,
      },
      cell: {
        left: outer.left,
        right: outer.right,
        top: outer.top,
        bottom: outer.bottom,
      },
    };
  });
  expect(
    bounds,
    `Feedback text must fit inside the grid cell: ${JSON.stringify(bounds)}`,
  ).toMatchObject({ fits: true });
}

test("custom priority select shows a failed save and accepts a corrected numeric value", async ({
  page,
}) => {
  await page.goto("/docs/grid/editing", { waitUntil: "domcontentloaded" });
  const example = page
    .locator("figure")
    .filter({ has: page.getByText("Custom cell editor", { exact: true }) });
  await example.scrollIntoViewIfNeeded();
  await expect(
    example.locator("[data-pretable-scroll-viewport]"),
  ).toHaveAttribute("data-pretable-hydrated", "true");
  const cell = example.locator(
    '[data-pretable-row-id="t1"] [data-pretable-column-id="priority"]',
  );
  await expect(cell).toHaveText("Medium");
  await cell.click();
  await page.keyboard.press("F2");
  const editor = example.getByRole("combobox", { name: "Priority" });
  await expect(editor).toBeFocused();
  await editor.selectOption("3");
  await editor.press("Enter");
  await expect(editor).toHaveAttribute("aria-busy", "true");
  await expect(
    example.getByRole("status").filter({ hasText: "Saving…" }),
  ).toHaveText("Saving…");
  await expectFeedbackInsideCell(
    example.getByRole("status").filter({ hasText: "Saving…" }),
  );
  await expect(example.getByRole("alert")).toHaveText(
    "Choose Medium or Low for the proposal.",
  );
  await expectFeedbackInsideCell(example.getByRole("alert"));
  await expect(editor).toHaveValue("3");
  await expect(editor).toHaveAttribute("aria-invalid", "true");
  await editor.selectOption("1");
  await editor.press("Enter");
  await expect(editor).toHaveCount(0);
  await expect(cell).toHaveText("Low");
  await expect(example.getByRole("alert")).toHaveCount(0);
  await cell.click();
  await page.keyboard.press("F2");
  await expect(editor).toHaveValue("1");
  await editor.selectOption("2");
  await editor.press("Escape");
  await expect(editor).toHaveCount(0);
  await expect(cell).toHaveText("Low");
});
