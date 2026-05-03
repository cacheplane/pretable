import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CopyPromptButton } from "../../app/components/CopyPromptButton";

const PROMPT = "AGENT PROMPT FIXTURE";

describe("CopyPromptButton", () => {
  let writeText: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, {
      clipboard: { writeText },
    });
    vi.useFakeTimers();
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it("renders an accessible button with the default label", () => {
    render(<CopyPromptButton prompt={PROMPT} />);
    expect(
      screen.getByRole("button", { name: /copy ai agent setup prompt/i }),
    ).toHaveTextContent(/copy prompt/i);
  });

  it("writes the prompt to the clipboard on click", () => {
    render(<CopyPromptButton prompt={PROMPT} />);
    fireEvent.click(screen.getByRole("button"));
    expect(writeText).toHaveBeenCalledWith(PROMPT);
  });

  it("flips the label to '✓ copied' for ~1.2s after a successful copy", async () => {
    render(<CopyPromptButton prompt={PROMPT} />);
    fireEvent.click(screen.getByRole("button"));
    await vi.waitFor(() =>
      expect(screen.getByRole("button")).toHaveTextContent(/copied/i),
    );
    vi.advanceTimersByTime(1300);
    await vi.waitFor(() =>
      expect(screen.getByRole("button")).toHaveTextContent(/copy prompt/i),
    );
  });
});
