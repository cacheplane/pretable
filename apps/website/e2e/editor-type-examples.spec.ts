import { expect, test, type Page } from "@playwright/test";

async function openExample(page: Page, kind: string) {
  await page.goto("/docs/grid/editing", { waitUntil: "domcontentloaded" });
  const example = page.locator("figure").filter({
    has: page.locator(`a[href="/examples/editor-${kind}.md"]`),
  });
  await example.scrollIntoViewIfNeeded();
  await expect(
    example.locator("[data-pretable-hydrated]").first(),
  ).toHaveAttribute("data-pretable-hydrated", "true", { timeout: 20_000 });
  return example;
}

async function beginEdit(page: Page, kind: string, columnId: string) {
  const example = await openExample(page, kind);
  const cell = example.locator(
    `[data-pretable-cell][data-pretable-column-id="${columnId}"]`,
  );
  await cell.click();
  await page.keyboard.press("F2");
  return { example, cell };
}

test("text editor cancels a draft and saves a task title", async ({ page }) => {
  const { example, cell } = await beginEdit(page, "text", "title");
  const input = example.getByRole("textbox", {
    name: "Task title",
    exact: true,
  });
  await input.fill("Discard this draft");
  await input.press("Escape");
  await expect(cell).toHaveText("Review launch checklist");
  await cell.click();
  await page.keyboard.press("F2");
  await input.fill("Publish release notes");
  await input.press("Enter");
  await expect(cell).toHaveText("Publish release notes");
  await expect(
    example.getByRole("status", { name: "Saved task title" }),
  ).toContainText('"Publish release notes"');
});

test("multiline editor inserts a newline and commits with Control Enter", async ({
  page,
}) => {
  const { example } = await beginEdit(page, "multiline", "notes");
  const input = example.getByRole("textbox", {
    name: "Handoff note",
    exact: true,
  });
  await input.fill("Release ready");
  await input.press("End");
  await input.press("Enter");
  await input.pressSequentially("Notify support");
  await expect(input).toHaveValue("Release ready\nNotify support");
  await expect(
    example.getByRole("status", { name: "Saved handoff note" }),
  ).not.toContainText("Release ready");
  await input.press("Control+Enter");
  await expect(input).toHaveCount(0);
  await expect(
    example.getByRole("status", { name: "Saved handoff note" }),
  ).toContainText('"Release ready\\nNotify support"');
});

test("number editor steps the draft, rejects non-numbers, and clears to null", async ({
  page,
}) => {
  const { example, cell } = await beginEdit(page, "number", "estimate");
  const input = example.getByRole("textbox", {
    name: "Estimate hours",
    exact: true,
  });
  await input.press("ArrowUp");
  await expect(input).toHaveValue("2.5");
  await expect(
    example.getByRole("status", { name: "Saved estimate hours" }),
  ).toHaveText("Saved value: 2");
  await input.press("Enter");
  await expect(cell).toHaveText("2.5");
  await cell.click();
  await page.keyboard.press("F2");
  await input.fill("not a number");
  await input.press("Enter");
  await expect(example.locator("[data-pretable-edit-error]")).toHaveText(
    "Not a number",
  );
  await input.fill("");
  await input.press("Enter");
  await expect(
    example.getByRole("status", { name: "Saved estimate hours" }),
  ).toHaveText("Saved value: null");
});

test("boolean editor toggles and saves directly from the keyboard", async ({
  page,
}) => {
  const example = await openExample(page, "boolean");
  const checkbox = example.getByRole("checkbox", { name: "Done", exact: true });
  await expect(checkbox).not.toBeChecked();
  await checkbox.focus();
  await checkbox.press("Space");
  await expect(checkbox).toBeChecked();
  await expect(
    example.getByRole("status", { name: "Saved completion" }),
  ).toHaveText("Saved value: true");
  await checkbox.press("Space");
  await expect(checkbox).not.toBeChecked();
  await expect(
    example.getByRole("status", { name: "Saved completion" }),
  ).toHaveText("Saved value: false");
});

test("enum editor rejects unknown text and saves the canonical option value", async ({
  page,
}) => {
  const { example, cell } = await beginEdit(page, "enum", "status");
  const input = example.getByRole("combobox", { name: "Status", exact: true });
  await input.fill("Unknown status");
  await input.press("Enter");
  await expect(example.locator("[data-pretable-edit-error]")).toHaveText(
    "Pick an option",
  );
  await input.fill("In progress");
  await page.getByRole("option", { name: "In progress", exact: true }).click();
  await expect(cell).toHaveText("in_progress");
  await expect(
    example.getByRole("status", { name: "Saved task status" }),
  ).toContainText('"in_progress"');
});

test("date editor rejects overflow, accepts a canonical date, and clears to null", async ({
  page,
}) => {
  const { example, cell } = await beginEdit(page, "date", "due");
  const input = example.getByRole("combobox", {
    name: "Due date",
    exact: true,
  });
  await expect(input).toHaveAttribute("aria-haspopup", "grid");
  await input.fill("2026-02-30");
  await input.press("Enter");
  await expect(example.locator("[data-pretable-edit-error]")).toHaveText(
    "Use YYYY-MM-DD",
  );
  await input.fill("2026-10-05");
  await input.press("Enter");
  await expect(
    example.getByRole("status", { name: "Saved due date" }),
  ).toContainText('"2026-10-05"');
  await cell.click();
  await page.keyboard.press("F2");
  await input.fill("");
  await input.press("Enter");
  await expect(
    example.getByRole("status", { name: "Saved due date" }),
  ).toHaveText("Saved value: null");
});

test("all editor examples expose complete source and fit mobile pages", async ({
  page,
  request,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  for (const kind of [
    "text",
    "multiline",
    "number",
    "boolean",
    "enum",
    "date",
  ]) {
    const example = await openExample(page, kind);
    await expect(example.getByRole("status", { name: /^Saved/ })).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    const source = await request.get(`/examples/editor-${kind}.md`);
    expect(source.ok()).toBe(true);
    expect(await source.text()).toContain("onRowChange");
  }
});
