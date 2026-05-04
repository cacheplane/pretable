import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import {
  ControlStateProvider,
  useControlState,
} from "../heroGrid/controlState";
import { TopControlBar } from "../TopControlBar";

function ControlsAccessor({
  onState,
}: {
  onState: (s: ReturnType<typeof useControlState>) => void;
}) {
  const state = useControlState();
  onState(state);
  return null;
}

describe("TopControlBar", () => {
  it("renders the brand link to the home page", () => {
    render(
      <ControlStateProvider>
        <TopControlBar fps={60} eventsPerSec={1000} p95Ms={9.3} />
      </ControlStateProvider>,
    );
    const brand = screen.getByRole("link", { name: /pretable\.ai/i });
    expect(brand).toHaveAttribute("href", "/");
  });

  it("renders the live counter with events/sec, p95, and fps", () => {
    render(
      <ControlStateProvider>
        <TopControlBar fps={59} eventsPerSec={1247} p95Ms={9.3} />
      </ControlStateProvider>,
    );
    expect(screen.getByText(/1,247/)).toBeInTheDocument();
    expect(screen.getByText(/9\.3/)).toBeInTheDocument();
    expect(
      screen.getByText((_, el) => el?.textContent === "59 fps"),
    ).toBeInTheDocument();
  });

  it("toggles isPaused on pause-button click", () => {
    let captured: ReturnType<typeof useControlState> | null = null;
    render(
      <ControlStateProvider>
        <TopControlBar fps={60} eventsPerSec={1000} p95Ms={9.3} />
        <ControlsAccessor onState={(s) => (captured = s)} />
      </ControlStateProvider>,
    );
    expect(captured!.isPaused).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: /pause/i }));
    expect(captured!.isPaused).toBe(true);
  });

  it("changes ratePerSec when slider tier is clicked", () => {
    let captured: ReturnType<typeof useControlState> | null = null;
    render(
      <ControlStateProvider>
        <TopControlBar fps={60} eventsPerSec={1000} p95Ms={9.3} />
        <ControlsAccessor onState={(s) => (captured = s)} />
      </ControlStateProvider>,
    );
    fireEvent.click(screen.getByRole("radio", { name: /heavy/i }));
    expect(captured!.ratePerSec).toBe(250);
  });
});
