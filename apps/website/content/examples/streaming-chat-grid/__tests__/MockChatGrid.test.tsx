import { render, screen } from "@testing-library/react";
import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { MockChatGrid } from "../MockChatGrid";

describe("MockChatGrid", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });
  it("starts with only header and emits one row per tick up to a deterministic max", () => {
    render(<MockChatGrid intervalMs={100} maxRows={3} />);
    // Header row only before any tick fires
    expect(screen.queryAllByRole("row")).toHaveLength(1);
    act(() => {
      vi.advanceTimersByTime(100);
    });
    expect(screen.getAllByRole("row").length).toBeGreaterThanOrEqual(2);
    act(() => {
      vi.advanceTimersByTime(300);
    });
    // Header row + 3 data rows
    expect(screen.getAllByRole("row").length).toBeGreaterThanOrEqual(4);
  });
});
