import { readFile } from "node:fs/promises";

import { expect, test, type Download, type Page } from "@playwright/test";

import { waitForGridReady } from "./helpers";

/**
 * The end of the CSV export path, which unit tests structurally cannot reach.
 *
 * jsdom can assert that `saveFile` received the right `PretableCsvFile`, and
 * `csv.test.ts` does so exhaustively. What it cannot answer is whether a real
 * browser treats the synthetic `<a download>` click as a download at all,
 * whether it honours the computed filename, and whether the bytes survive the
 * `Blob` URL round trip with their BOM and CRLF intact. Every one of those is
 * a place a green unit suite would still ship a broken button.
 *
 * The fixture leaves `saveFile` unset on purpose, so `defaultSaveFile` — the
 * anchor, the Blob, the MIME type, the deferred revoke — is what runs here.
 */

const FIXTURE = "/fixtures/csv-export";

async function openFixture(page: Page) {
  await page.goto(FIXTURE, { waitUntil: "domcontentloaded" });
  // The fixture renders the buttons `disabled` until `onGridReady` fires, so
  // `toBeEnabled()` is the real gate here — not `waitForGridReady`, which is
  // kept because a click landing between hydration and first paint is a
  // failure the enabled check alone would not describe.
  await waitForGridReady(page);
  await expect(page.getByTestId("export-all")).toBeEnabled();
}

/**
 * Click `testId` and return the download it produced, with its bytes.
 *
 * `waitForEvent` is armed BEFORE the click. Downloads are not queued: a click
 * that resolves faster than the listener is attached fires the event into
 * nothing and the test hangs until timeout, blaming the export.
 */
async function downloadVia(
  page: Page,
  testId: string,
): Promise<{ download: Download; bytes: Buffer }> {
  const pending = page.waitForEvent("download");
  await page.getByTestId(testId).click();
  const download = await pending;
  const path = await download.path();
  return { download, bytes: await readFile(path) };
}

/** The file's rows, with the BOM and the CRLF grammar taken off. */
function rows(bytes: Buffer): string[] {
  const text = bytes.toString("utf8").replace(/^﻿/, "");
  return text.split("\r\n").filter((line) => line.length > 0);
}

test("the button writes a real file the browser named for us", async ({
  page,
}) => {
  await openFixture(page);
  const { download, bytes } = await downloadVia(page, "export-all");

  // `buildExportFileName` stamps a colon-free compact ISO timestamp and the
  // extension. The instant is whatever the browser's clock says, so it is
  // matched by shape — but the shape is the assertion: Chromium rewrites `:`
  // to `_` on every OS, so a raw `toISOString()` would arrive here mangled.
  // Matching exactly also proves Chromium took our name rather than
  // substituting one of its own (`download`, or a `.txt` inferred from MIME).
  expect(download.suggestedFilename()).toMatch(/^export-\d{8}T\d{6}Z\.csv$/);
  // No omission, so no `-PARTIAL`: the fixture holds every row it claims to.
  expect(download.suggestedFilename()).not.toContain("PARTIAL");

  const lines = rows(bytes);
  expect(lines[0]).toBe("Symbol,Desk,Note,Qty");
  expect(lines).toHaveLength(5);
});

test("the bytes on disk keep the BOM and CRLF Excel needs", async ({
  page,
}) => {
  await openFixture(page);
  const { bytes } = await downloadVia(page, "export-all");

  // Excel reads a BOM-less UTF-8 CSV in the OS legacy codepage, which is how
  // `Größe` becomes `GrÃ¶ÃŸe`. The BOM is the whole fix, and it has to reach
  // disk — a Blob built from a string the platform re-encodes would lose it.
  expect(bytes[0]).toBe(0xef);
  expect(bytes[1]).toBe(0xbb);
  expect(bytes[2]).toBe(0xbf);

  const text = bytes.toString("utf8");
  expect(text).toContain("Größe");
  // RFC 4180 line endings, not the platform's.
  expect(text).toContain("\r\n");
  expect(text.replace(/\r\n/g, "")).not.toContain("\n");
});

test("formula escaping reaches disk, and negative numbers do not", async ({
  page,
}) => {
  await openFixture(page);
  const { bytes } = await downloadVia(page, "export-all");
  const lines = rows(bytes);

  // `=1+1` would be evaluated on open; the apostrophe is the neutralizer. The
  // field is NOT quoted — `escapeCsvField` quotes on the delimiter, `"`, CR or
  // LF, and an apostrophe is none of those. Asserted as the whole line rather
  // than a substring, so the quoting is pinned too: `toContain` passed under
  // either reading and so tested neither.
  const msft = lines.find((line) => line.startsWith("MSFT"));
  expect(msft).toBe("MSFT,Equity,'=1+1,800");

  // The Jira/MUI bug in the other direction: `-450` is a genuine `number`, so
  // it is exempt by JS type and must arrive intact. An apostrophe here turns a
  // numeric column into text in every spreadsheet that opens it.
  const nvda = lines.find((line) => line.startsWith("NVDA"));
  expect(nvda).toContain("-450");
  expect(nvda).not.toContain("'-450");

  // Quoting is minimal and inner quotes are doubled.
  const sap = lines.find((line) => line.startsWith("SAP"));
  expect(sap).toContain('"Frankfurt, ""Größe"""');
});

test("selected-only exports the checked rows; an empty selection exports everything", async ({
  page,
}) => {
  await openFixture(page);

  // Nothing checked yet. A zero-row file reads as a broken button, so the
  // empty selection deliberately falls through to the whole grid.
  const all = await downloadVia(page, "export-selected");
  expect(rows(all.bytes)).toHaveLength(5);

  await page
    .getByRole("row", { name: /AAPL/ })
    .getByRole("checkbox", { name: "Select row" })
    .click();
  await page
    .getByRole("row", { name: /NVDA/ })
    .getByRole("checkbox", { name: "Select row" })
    .click();

  const selected = await downloadVia(page, "export-selected");
  const lines = rows(selected.bytes);
  expect(lines[0]).toBe("Symbol,Desk,Note,Qty");
  expect(lines.slice(1).map((line) => line.split(",")[0])).toEqual([
    "AAPL",
    "NVDA",
  ]);
});
