import { readFile } from "node:fs/promises";
import { expect, test, type Page } from "@playwright/test";

async function openPreview(page: Page) {
  await page.goto("/docs/grid/export", { waitUntil: "domcontentloaded" });
  const example = page.locator("figure").filter({
    has: page.locator('a[href="/examples/export-preview.md"]'),
  });
  await example.scrollIntoViewIfNeeded();
  await expect(
    example.locator("[data-pretable-hydrated]").first(),
  ).toHaveAttribute("data-pretable-hydrated", "true", { timeout: 20_000 });
  return example;
}

test("CSV preview quotes formatted data and downloads the exact captured file", async ({
  page,
}) => {
  const example = await openPreview(page);
  const downloadButton = example.getByRole("button", { name: "Download CSV" });
  await expect(downloadButton).toBeDisabled();
  await example.getByRole("button", { name: "Preview CSV" }).click();
  const preview = example.getByLabel("CSV preview", { exact: true });
  const text = await preview.textContent();
  expect(text?.split(/\r?\n/).filter(Boolean)).toEqual([
    "Order,Customer,Total",
    'ORD-101,"Acme, Inc.","$1,234.50"',
    'ORD-102,"Beacon ""Labs""",$99.00',
    "ORD-103,Cedar,$0.00",
  ]);
  const pending = page.waitForEvent("download");
  await downloadButton.click();
  const download = await pending;
  expect(download.suggestedFilename()).toMatch(
    /^orders-preview-\d{8}T\d{6}Z\.csv$/,
  );
  const path = await download.path();
  expect(path).not.toBeNull();
  expect(await readFile(path!, "utf8")).toBe(text);
});

test("CSV settings invalidate old previews and control columns, headers, and delimiters", async ({
  page,
}) => {
  const example = await openPreview(page);
  const generate = example.getByRole("button", { name: "Preview CSV" });
  const download = example.getByRole("button", { name: "Download CSV" });
  const preview = example.getByLabel("CSV preview", { exact: true });
  await generate.click();
  await example
    .getByRole("checkbox", { name: "Customer", exact: true })
    .uncheck();
  await expect(preview).toHaveCount(0);
  await expect(download).toBeDisabled();
  await example.getByRole("checkbox", { name: "Include headers" }).uncheck();
  for (const delimiter of [";", "\t"]) {
    await example
      .getByRole("combobox", { name: "Delimiter", exact: true })
      .selectOption(delimiter);
    await expect(download).toBeDisabled();
    await generate.click();
    expect(
      (await preview.textContent())?.split(/\r?\n/).filter(Boolean),
    ).toEqual([
      `ORD-101${delimiter}$1,234.50`,
      `ORD-102${delimiter}$99.00`,
      `ORD-103${delimiter}$0.00`,
    ]);
  }
  await example.getByRole("checkbox", { name: "Order", exact: true }).uncheck();
  await example.getByRole("checkbox", { name: "Total", exact: true }).uncheck();
  await expect(generate).toBeDisabled();
  await expect(download).toBeDisabled();
  await expect(example).toContainText("Select at least one column to preview.");
  await example
    .getByRole("checkbox", { name: "Customer", exact: true })
    .check();
  await generate.click();
  await expect(preview).toContainText('"Beacon ""Labs"""');
});

test("CSV example source is complete and preview stays within a mobile page", async ({
  page,
  request,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const example = await openPreview(page);
  await example.getByRole("button", { name: "Preview CSV" }).click();
  await expect(
    example.getByLabel("CSV preview", { exact: true }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  const response = await request.get("/examples/export-preview.md");
  expect(response.ok()).toBe(true);
  const source = await response.text();
  expect(source).toContain("saveFile={setPreview}");
  expect(source).toContain("defaultSaveFile(preview");
});
