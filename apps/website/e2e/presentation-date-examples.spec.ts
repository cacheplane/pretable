import { expect, test, type Page } from "@playwright/test";

async function openExample(page: Page, route: string, id: string) {
  await page.goto(`/docs/grid/${route}`, { waitUntil: "domcontentloaded" });
  const example = page.locator("figure").filter({
    has: page.locator(`a[href="/examples/${id}.md"]`),
  });
  await example.scrollIntoViewIfNeeded();
  return example;
}

test("Invoice dates change locale without changing raw values and sort empty dates last", async ({
  page,
  request,
}) => {
  const example = await openExample(page, "date-formatting", "date-formatting");
  const grid = example.getByRole("grid", { name: "Invoice due dates" });
  const ids = grid.locator(
    '[data-pretable-cell][data-pretable-column-id="id"]',
  );
  const raw = grid.locator(
    '[data-pretable-cell][data-pretable-column-id="rawDue"]',
  );
  const formatted = grid.locator(
    '[data-pretable-cell][data-pretable-column-id="due"]',
  );
  await expect(ids).toHaveText(["INV-102", "INV-101", "INV-103", "INV-104"]);
  await expect(raw).toHaveText([
    "2026-01-15",
    "2026-09-18",
    "2026-12-02",
    "null",
  ]);
  await expect(formatted).toHaveText([
    "Jan 15, 2026",
    "Sep 18, 2026",
    "Dec 2, 2026",
    "",
  ]);
  await example.getByLabel("Date locale").selectOption("en-GB");
  await expect(formatted).toHaveText([
    "15 Jan 2026",
    /^18 Sept? 2026$/,
    "2 Dec 2026",
    "",
  ]);
  await expect(raw).toHaveText([
    "2026-01-15",
    "2026-09-18",
    "2026-12-02",
    "null",
  ]);
  await example.getByLabel("Date locale").selectOption("de-DE");
  await expect(formatted).toHaveText([
    "15.01.2026",
    "18.09.2026",
    "02.12.2026",
    "",
  ]);
  await example.getByRole("button", { name: "Latest first" }).click();
  await expect(ids).toHaveText(["INV-103", "INV-101", "INV-102", "INV-104"]);
  await example.getByRole("button", { name: "Earliest first" }).click();
  await expect(ids).toHaveText(["INV-102", "INV-101", "INV-103", "INV-104"]);
  const source = await request.get("/examples/date-formatting.md");
  expect(source.ok()).toBe(true);
  const markdown = await source.text();
  for (const file of ["InvoiceDatesGrid.tsx", "columns.ts", "data.ts"])
    expect(markdown).toContain(file);
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(example.getByLabel("Date locale")).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
});

const galleries = [
  {
    id: "presentation-delta",
    selector: "[data-pretable-delta]",
    labels: ["+$1,250.50", "-$640.75", "$0.00"],
  },
  {
    id: "presentation-status",
    selector: "[data-pretable-status]",
    labels: ["Settled", "Failed", "Pending", "Processing", "Not started"],
  },
  {
    id: "presentation-badge",
    selector: "[data-pretable-badge]",
    labels: ["Approved", "Risk", "Watch", "Review", "Standard"],
  },
  {
    id: "presentation-entity",
    selector: "[data-pretable-entity]",
    labels: ["NVDANVIDIA Corp.", "MSFT"],
  },
];

for (const gallery of galleries) {
  test(`${gallery.id} shows labeled variants and copyable source on mobile`, async ({
    page,
    request,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const example = await openExample(page, "cell-presentations", gallery.id);
    await expect(example.locator(gallery.selector)).toHaveText(gallery.labels);
    if (gallery.id === "presentation-delta") {
      await expect(example.locator('[data-pretable-delta="flat"]')).toHaveText(
        "$0.00",
      );
    }
    if (gallery.id === "presentation-badge") {
      await expect(
        example.getByText("Standard", { exact: true }),
      ).not.toHaveAttribute("data-pretable-tone");
    }
    if (gallery.id === "presentation-entity") {
      await expect(
        example.locator("[data-pretable-entity-secondary]"),
      ).toHaveText(["NVIDIA Corp."]);
    }
    const source = await request.get(`/examples/${gallery.id}.md`);
    expect(source.ok()).toBe(true);
    expect(await source.text()).toContain("@pretable/react");
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
  });
}
