import { expect, test, type Page } from "@playwright/test";

async function example(page: Page, slug: string) {
  await page.goto("/docs/grid/components");
  const figure = page.locator("figure").filter({
    has: page.locator(`a[href="/examples/${slug}.md"]`),
  });
  await figure.scrollIntoViewIfNeeded();
  return figure;
}

test("TextInput searches teammates and clears back to the full list", async ({
  page,
}) => {
  const figure = await example(page, "kit-text-input");
  const field = figure.getByRole("searchbox", { name: "Find a teammate" });
  await expect(figure.getByRole("listitem")).toHaveCount(3);
  await field.fill("grace");
  await expect(figure.getByRole("listitem")).toHaveText(["Grace Hopper"]);
  await expect(figure.getByRole("status")).toHaveText("1 person found");
  await field.fill("Nobody");
  await expect(figure.getByRole("listitem")).toHaveCount(0);
  await expect(figure.getByRole("status")).toHaveText("0 people found");
  await field.fill("");
  await expect(figure.getByRole("listitem")).toHaveCount(3);
});

test("Textarea preserves a multiline note and disables unchanged saves", async ({
  page,
}) => {
  const figure = await example(page, "kit-textarea");
  const field = figure.getByRole("textbox", { name: "Handoff note" });
  const save = figure.getByRole("button", { name: "Save note" });
  await expect(save).toBeDisabled();
  await expect(field).toHaveAccessibleDescription(
    "Up to 160 characters. Enter adds a new line.",
  );
  await field.fill("First line");
  await field.press("End");
  await field.press("Enter");
  await field.pressSequentially("Second line");
  await save.click();
  await expect(figure.getByRole("status")).toHaveText(
    "Saved note:\nFirst line\nSecond line",
  );
  await expect(field).toHaveValue("First line\nSecond line");
  await expect(save).toBeDisabled();
  await field.fill("Revised note");
  await expect(save).toBeEnabled();
});
