import { render, screen } from "@testing-library/react";
import { StrictMode, act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ChatGrid } from "../ChatGrid";
import { createScriptedResponseEvents } from "../scripted-response";

const INTERVAL_MS = 200;
const RESPONSE_DURATION_MS = 5 * INTERVAL_MS;

/**
 * `demo.test.tsx` renders this same grid WITHOUT StrictMode, and that is
 * exactly the blind spot this file exists to close: a production build does not
 * rehearse effects, so a model disposed in an effect cleanup keeps working
 * there while every contributor running `next dev` sees a blank grid.
 *
 * This example shipped that bug. `ChatGrid` held its row model in `useMemo` and
 * disposed it from a `useEffect` cleanup; StrictMode's rehearsed unmount ran the
 * cleanup, the remount got the same (now disposed) model back, and the grid
 * threw `A disposed row-layout controller cannot change its columns` and
 * rendered nothing. The fix is `useDisposeOnUnmount`.
 *
 * The repo's dev-mode Playwright gate covers the homepage and
 * `/docs/grid/grouping` only — it never loads a streaming page, so nothing
 * would have caught this. Deleting `useDisposeOnUnmount` from `ChatGrid.tsx`
 * must fail this test.
 */
describe("streaming-chat-grid under StrictMode", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("still streams rows when effects are rehearsed", async () => {
    render(
      <StrictMode>
        <ChatGrid
          prompt="Summarize the last 10 incidents."
          openResponseEvents={createScriptedResponseEvents(INTERVAL_MS)}
        />
      </StrictMode>,
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(RESPONSE_DURATION_MS * 3);
    });

    // Header row + 3 scripted assistant responses. Asserting the ROWS, not just
    // that the component mounted: the failure mode is a grid that renders its
    // header and no data, which a "did it mount" check passes.
    expect(screen.getAllByRole("row")).toHaveLength(4);
    expect(
      screen.getAllByRole("gridcell").map((cell) => cell.textContent),
    ).toContain("assistant");
  });
});
