import { expect, test, type Page } from "@playwright/test";

async function choiceExample(page: Page, id: string) {
  await page.goto("/docs/grid/components", { waitUntil: "domcontentloaded" });
  const example = page.locator("figure").filter({
    has: page.locator(`a[href="/examples/${id}.md"]`),
  });
  await example.scrollIntoViewIfNeeded();
  return example;
}

test("Select sorts projects with keyboard typeahead and skips a disabled option", async ({
  page,
}) => {
  const example = await choiceExample(page, "kit-select");
  const select = example.getByRole("combobox", { name: "Sort projects" });
  const projects = example
    .getByRole("list", { name: "Projects" })
    .getByRole("listitem");
  await expect(projects).toHaveText(["Atlas", "Beacon", "Cedar"]);
  await select.focus();
  await select.press("ArrowDown");
  const listbox = page.getByRole("listbox");
  await expect(listbox).toBeVisible();
  await expect(
    listbox.getByRole("option", { name: "Manual order (unavailable)" }),
  ).toHaveAttribute("aria-disabled", "true");
  await select.press("ArrowDown");
  await select.press("Enter");
  await expect(select).toHaveAttribute("data-pretable-value", "descending");
  await expect(projects).toHaveText(["Cedar", "Beacon", "Atlas"]);
  await expect(select).toBeFocused();
  await select.press("ArrowDown");
  await select.press("r");
  await select.press("Enter");
  await expect(select).toHaveAttribute("data-pretable-value", "recent");
  await expect(projects).toHaveText(["Beacon", "Cedar", "Atlas"]);
  await select.press("ArrowDown");
  await select.press("Home");
  await select.press("Escape");
  await expect(select).toHaveAttribute("data-pretable-value", "recent");
  await expect(listbox).toHaveCount(0);
});

test("Checkbox select-all moves from mixed to all to none and rows update it", async ({
  page,
}) => {
  const example = await choiceExample(page, "kit-checkbox");
  const all = example.getByRole("checkbox", { name: "Select all projects" });
  const atlas = example.getByRole("checkbox", { name: "Atlas", exact: true });
  const beacon = example.getByRole("checkbox", { name: "Beacon", exact: true });
  const cedar = example.getByRole("checkbox", { name: "Cedar", exact: true });
  await expect(all).toHaveAttribute("aria-checked", "mixed");
  await expect(atlas).toBeChecked();
  await expect(beacon).not.toBeChecked();
  await all.focus();
  await all.press("Space");
  for (const checkbox of [all, atlas, beacon, cedar])
    await expect(checkbox).toBeChecked();
  await all.press("Space");
  for (const checkbox of [all, atlas, beacon, cedar])
    await expect(checkbox).not.toBeChecked();
  await example.getByText("Beacon", { exact: true }).click();
  await expect(beacon).toBeChecked();
  await expect(all).toHaveAttribute("aria-checked", "mixed");
  await beacon.focus();
  await beacon.press("Enter");
  await expect(all).not.toBeChecked();
  await expect(example.getByRole("status")).toHaveText("0 of 3 selected");
});
