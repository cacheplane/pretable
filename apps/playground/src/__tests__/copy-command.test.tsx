import "@testing-library/jest-dom/vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import { CopyCommand } from "../copy-command";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("<CopyCommand />", () => {
  beforeEach(() => {
    Object.assign(navigator, {
      clipboard: { writeText: vi.fn().mockResolvedValue(undefined) },
    });
  });

  test("renders the command with a leading $ and an accessible label", () => {
    render(<CopyCommand command="npm i @pretable/react" />);

    const button = screen.getByRole("button", {
      name: /copy install command/i,
    });
    expect(button).toBeInTheDocument();
    expect(button).toHaveTextContent("$ npm i @pretable/react");
  });

  test("writes the command (without the $ ) to the clipboard on click", async () => {
    render(<CopyCommand command="npm i @pretable/react" />);

    const button = screen.getByRole("button", {
      name: /copy install command/i,
    });
    await act(async () => {
      fireEvent.click(button);
    });

    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(
      "npm i @pretable/react",
    );
  });

  test("flashes a ✓ copied indicator after a successful copy, then reverts", async () => {
    vi.useFakeTimers();

    render(<CopyCommand command="npm i @pretable/react" />);

    const button = screen.getByRole("button", {
      name: /copy install command/i,
    });

    // Click and let the clipboard promise + setState flush through React.
    await act(async () => {
      fireEvent.click(button);
    });

    expect(button).toHaveTextContent(/copied/i);

    // Advance past the 1200ms revert timer and flush the resulting render.
    await act(async () => {
      vi.advanceTimersByTime(1300);
    });

    expect(button).toHaveTextContent("$ npm i @pretable/react");
  });
});
