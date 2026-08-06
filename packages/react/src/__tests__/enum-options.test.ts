import { describe, expect, it } from "vitest";

import {
  filterOptions,
  matchOption,
  optionLabel,
} from "../editors/enum-options";

const OPTS = [
  { value: "running", label: "Running" },
  { value: "queued" },
  { value: "done", label: "Done" },
];

describe("enum option helpers", () => {
  it("optionLabel falls back to the value", () => {
    expect(optionLabel(OPTS[0])).toBe("Running");
    expect(optionLabel(OPTS[1])).toBe("queued");
  });

  it("matchOption matches label or value, case-insensitively", () => {
    expect(matchOption(OPTS, "running")?.value).toBe("running");
    expect(matchOption(OPTS, "  DONE ")?.value).toBe("done");
    expect(matchOption(OPTS, "queued")?.value).toBe("queued");
  });

  it("matchOption returns undefined for no match or empty text", () => {
    expect(matchOption(OPTS, "nope")).toBeUndefined();
    expect(matchOption(OPTS, "   ")).toBeUndefined();
  });

  it("filterOptions substring-filters on label and value; empty text = all", () => {
    expect(filterOptions(OPTS, "")).toHaveLength(3);
    expect(filterOptions(OPTS, "ru").map((o) => o.value)).toEqual(["running"]);
    expect(filterOptions(OPTS, "ue").map((o) => o.value)).toEqual(["queued"]);
    expect(filterOptions(OPTS, "zz")).toEqual([]);
  });
});
