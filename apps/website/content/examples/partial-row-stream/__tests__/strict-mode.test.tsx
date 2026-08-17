import { render, screen } from "@testing-library/react";
import { StrictMode, act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import Demo from "../demo";
import { FIRST_REPLY, INTERVAL_MS, SECOND_REPLY } from "../scripted-partials";

const FULL_DURATION_MS =
  Math.max(FIRST_REPLY.length, SECOND_REPLY.length) * INTERVAL_MS + INTERVAL_MS;

/**
 * The StrictMode twin of `demo.test.tsx`. See the sibling file in
 * `streaming-chat-grid/__tests__/strict-mode.test.tsx` for why a non-StrictMode
 * render cannot see this class of failure: production builds do not rehearse
 * effects, so a row model disposed in an effect cleanup keeps working there
 * while `next dev` renders a blank grid.
 *
 * This example shipped that bug alongside the chat grid. Deleting
 * `useDisposeOnUnmount` from `PartialRowGrid.tsx` must fail this test.
 */
describe("partial-row-stream under StrictMode", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("still seeds, creates and grows its rows when effects are rehearsed", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});

    render(
      <StrictMode>
        <Demo />
      </StrictMode>,
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(FULL_DURATION_MS);
    });

    // Header + msg-1 (seeded) + msg-2 (built by createRow). Asserting the rows,
    // not just that it mounted: the failure mode renders a header and no data.
    expect(screen.getAllByRole("row")).toHaveLength(3);
    expect(
      screen.getAllByRole("gridcell").map((cell) => cell.textContent ?? ""),
    ).toContain(FIRST_REPLY);
  });
});
