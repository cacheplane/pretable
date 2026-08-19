import { describe, expect, it } from "vitest";

import { parseDraftForType } from "../editors/type-parsing";

describe("parseDraftForType", () => {
  it("passes text drafts through unchanged", () => {
    expect(parseDraftForType({ type: "text" }, "hi")).toEqual({
      ok: true,
      value: "hi",
    });
  });

  it("parses numeric strings for number columns", () => {
    expect(parseDraftForType({ type: "number" }, "42.5")).toEqual({
      ok: true,
      value: 42.5,
    });
  });

  it("rejects non-numeric drafts for number columns", () => {
    expect(parseDraftForType({ type: "number" }, "abc")).toEqual({
      ok: false,
      message: "Not a number",
    });
  });

  it("commits null for an empty number draft", () => {
    expect(parseDraftForType({ type: "number" }, "")).toEqual({
      ok: true,
      value: null,
    });
    expect(parseDraftForType({ type: "number" }, "   ")).toEqual({
      ok: true,
      value: null,
    });
  });

  it("passes boolean drafts through unchanged", () => {
    expect(parseDraftForType({ type: "boolean" }, true)).toEqual({
      ok: true,
      value: true,
    });
  });
});

describe("parseDraftForType — enum", () => {
  const column = {
    type: "enum" as const,
    options: [{ value: "running", label: "Running" }, { value: "done" }],
  };

  it("maps a matching label to the option value", () => {
    expect(parseDraftForType(column, "Running")).toEqual({
      ok: true,
      value: "running",
    });
  });

  it("accepts a raw value too", () => {
    expect(parseDraftForType(column, "done")).toEqual({
      ok: true,
      value: "done",
    });
  });

  it("rejects text that matches no option", () => {
    expect(parseDraftForType(column, "nope")).toEqual({
      ok: false,
      message: "Pick an option",
    });
  });

  it("commits null for an empty draft", () => {
    expect(parseDraftForType(column, "")).toEqual({ ok: true, value: null });
  });

  it("passes through when the column declares no options (text behavior)", () => {
    expect(parseDraftForType({ type: "enum" }, "anything")).toEqual({
      ok: true,
      value: "anything",
    });
  });
});

describe("parseDraftForType — date", () => {
  const column = { type: "date" as const };

  it("accepts a strict ISO date", () => {
    expect(parseDraftForType(column, "2026-08-06")).toEqual({
      ok: true,
      value: "2026-08-06",
    });
  });

  it("commits null only for an exact user-cleared empty draft", () => {
    expect(parseDraftForType(column, "")).toEqual({ ok: true, value: null });
    expect(parseDraftForType(column, null)).toEqual({
      ok: false,
      message: "Use YYYY-MM-DD",
    });
    expect(parseDraftForType(column, undefined)).toEqual({
      ok: false,
      message: "Use YYYY-MM-DD",
    });
  });

  it.each([
    ["Date", new Date("2026-08-06T00:00:00Z")],
    ["epoch", Date.UTC(2026, 7, 6)],
    ["datetime", "2026-08-06T00:00:00Z"],
    ["loose", "2026-8-6"],
    ["overflow", "2026-02-30"],
    ["padded", " 2026-08-06 "],
    ["whitespace", "   "],
    ["locale", "08/06/2026"],
  ])("rejects %s without coercion or trimming", (_label, draft) => {
    expect(parseDraftForType(column, draft)).toEqual({
      ok: false,
      message: "Use YYYY-MM-DD",
    });
  });
});
