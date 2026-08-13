import { render, screen } from "@testing-library/react";
import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import Demo from "../demo";
import { FIRST_REPLY, INTERVAL_MS, SECOND_REPLY } from "../scripted-partials";

// Both scripted replies advance one character per INTERVAL_MS; give the
// longer of the two enough ticks to fully land, plus a little slack for
// the RAF-batched flush that follows the final partial.
const FULL_DURATION_MS =
  Math.max(FIRST_REPLY.length, SECOND_REPLY.length) * INTERVAL_MS + INTERVAL_MS;

describe("partial-row-stream demo", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("seeds msg-1 up front, then creates msg-2 via createRow and grows both in place", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    render(<Demo />);

    // "msg-1" is seeded before either stream connects; "msg-2" is not —
    // only the header row and msg-1 exist at first paint.
    expect(screen.getAllByRole("row")).toHaveLength(2);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(FULL_DURATION_MS);
    });

    // "msg-2" now exists: createRow built it from its first partial after
    // onIssue reported the unknown target.
    expect(screen.getAllByRole("row")).toHaveLength(3);
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("unknown-update-id"),
    );

    const finalCells = screen
      .getAllByRole("gridcell")
      .map((cell) => cell.textContent ?? "");
    expect(finalCells).toContain(FIRST_REPLY);
    expect(finalCells).toContain(SECOND_REPLY);

    warnSpy.mockRestore();
  });
});
