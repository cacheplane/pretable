import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { Prompt } from "../Prompt";

describe("Prompt", () => {
  it("renders prompt text and copies flattened text", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    render(
      <Prompt>
        Summarize the last <strong>10</strong> incidents.
      </Prompt>,
    );
    fireEvent.click(screen.getByRole("button", { name: /copy prompt/i }));
    expect(writeText).toHaveBeenCalledWith(
      "Summarize the last 10 incidents.",
    );
  });
});
