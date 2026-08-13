import { render, screen } from "@testing-library/react";
import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ChatGrid } from "../ChatGrid";
import { createScriptedResponseEvents } from "../scripted-response";

// One scripted response is `response.created` + 3 text deltas +
// `response.completed`, each separated by `intervalMs` — a full response
// takes 5 * intervalMs to land as a row.
const INTERVAL_MS = 200;
const RESPONSE_DURATION_MS = 5 * INTERVAL_MS;

describe("streaming-chat-grid demo", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("streams rows into the real ChatGrid one at a time as responses complete", async () => {
    render(
      <ChatGrid
        prompt="Summarize the last 10 incidents."
        openResponseEvents={createScriptedResponseEvents(INTERVAL_MS)}
      />,
    );

    // Header row only before the first response completes.
    expect(screen.getAllByRole("row")).toHaveLength(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(RESPONSE_DURATION_MS);
    });
    expect(screen.getAllByRole("row")).toHaveLength(2);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(RESPONSE_DURATION_MS);
    });
    expect(screen.getAllByRole("row")).toHaveLength(3);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(RESPONSE_DURATION_MS);
    });
    // Header row + 3 scripted assistant responses.
    expect(screen.getAllByRole("row")).toHaveLength(4);

    const cells = screen.getAllByRole("gridcell");
    expect(cells.map((cell) => cell.textContent)).toContain("assistant");
  });
});
