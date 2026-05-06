import { describe, expect, test } from "vitest";

import { autosizeColumns } from "../index";

describe("autosizeColumns", () => {
  const rows = [
    {
      id: "1",
      name: "Alice",
      status: "ok",
      description: "A longer description that should make the column wider",
    },
    { id: "2", name: "Bob", status: "pending", description: "Short" },
    {
      id: "3",
      name: "Charlie Brown",
      status: "ok",
      description: "Medium length text",
    },
  ];

  test("computes widths based on content length", () => {
    const result = autosizeColumns({
      columns: [
        { id: "name", header: "Name" },
        { id: "status", header: "Status" },
        { id: "description", header: "Description" },
      ],
      rows,
    });

    const nameWidth = result.widths.get("name")!;
    const statusWidth = result.widths.get("status")!;
    const descriptionWidth = result.widths.get("description")!;

    expect(nameWidth).toBeGreaterThan(statusWidth);
    expect(descriptionWidth).toBeGreaterThan(nameWidth);
    expect(result.widths.size).toBe(3);
  });

  test("skips columns with explicit widthPx", () => {
    const result = autosizeColumns({
      columns: [
        { id: "name", header: "Name", widthPx: 200 },
        { id: "status", header: "Status" },
      ],
      rows,
    });

    expect(result.widths.has("name")).toBe(false);
    expect(result.widths.has("status")).toBe(true);
  });

  test("respects maxWidthPx cap", () => {
    const result = autosizeColumns({
      columns: [{ id: "description", header: "Description" }],
      rows,
      options: { maxWidthPx: 100 },
    });

    expect(result.widths.get("description")!).toBeLessThanOrEqual(100);
  });

  test("respects minWidthPx floor", () => {
    const result = autosizeColumns({
      columns: [{ id: "status", header: "S" }],
      rows: [{ id: "1", status: "" }],
      options: { minWidthPx: 80 },
    });

    expect(result.widths.get("status")!).toBeGreaterThanOrEqual(80);
  });

  test("includes header text width in calculation", () => {
    const result = autosizeColumns({
      columns: [{ id: "status", header: "A Very Long Header Name" }],
      rows: [{ id: "1", status: "ok" }],
    });

    expect(result.widths.get("status")!).toBeGreaterThan(100);
  });

  test("uses default options when none provided", () => {
    const result = autosizeColumns({
      columns: [{ id: "name", header: "Name" }],
      rows,
    });

    const width = result.widths.get("name")!;

    expect(width).toBeGreaterThanOrEqual(60);
    expect(width).toBeLessThanOrEqual(400);
  });

  test("uses value when provided", () => {
    const result = autosizeColumns({
      columns: [
        {
          id: "computed",
          header: "Computed",
          value: (row: Record<string, unknown>) =>
            `${row.name}-${row.status}`,
        },
      ],
      rows,
    });

    expect(result.widths.get("computed")!).toBeGreaterThan(100);
  });

  test("handles empty rows", () => {
    const result = autosizeColumns({
      columns: [{ id: "name", header: "Name" }],
      rows: [],
    });

    expect(result.widths.get("name")!).toBe(60);
  });

  test("handles null and undefined cell values", () => {
    const result = autosizeColumns({
      columns: [{ id: "missing", header: "Missing" }],
      rows: [
        { id: "1" },
        { id: "2", missing: null },
        { id: "3", missing: undefined },
      ],
    });

    expect(result.widths.get("missing")!).toBeGreaterThanOrEqual(60);
  });

  test("handles emoji and multi-byte characters correctly", () => {
    const result = autosizeColumns({
      columns: [{ id: "emoji", header: "Emoji" }],
      rows: [{ id: "1", emoji: "Hello 👋🌍" }],
    });

    expect(result.widths.get("emoji")!).toBeGreaterThanOrEqual(60);
  });
});
