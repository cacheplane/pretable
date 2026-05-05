import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { CodeGroup } from "../CodeGroup";

describe("CodeGroup", () => {
  it("uses data-language for tab labels and switches active panel", () => {
    render(
      <CodeGroup>
        <pre data-language="ts">
          <code>ts-source</code>
        </pre>
        <pre data-language="js">
          <code>js-source</code>
        </pre>
      </CodeGroup>,
    );
    const tabs = screen.getAllByRole("tab");
    expect(tabs[0]).toHaveAttribute("aria-selected", "true");
    expect(screen.getByText("ts-source")).toBeInTheDocument();
    fireEvent.click(tabs[1]);
    expect(tabs[1]).toHaveAttribute("aria-selected", "true");
    expect(screen.getByText("js-source")).toBeInTheDocument();
  });
});
