import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { CopyPageButton } from "../CopyPageButton";

describe("CopyPageButton", () => {
  it("fetches <path>.md and writes to clipboard", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      text: () => Promise.resolve("# hi"),
    }) as unknown as typeof fetch;
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    render(<CopyPageButton path="/docs/grid" />);
    fireEvent.click(screen.getByRole("button", { name: /copy as markdown/i }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith("# hi"));
  });
});
