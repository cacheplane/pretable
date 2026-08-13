import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { Example } from "../Example";

// `Example` is an async Server Component — it awaits `loadExample` (real
// disk I/O + real Shiki highlighting) and looks the demo up in the real
// generated registry. Nothing else in this suite exercises that pipeline
// end to end: ExampleShell.test.tsx only covers the shell in isolation with
// synthetic files and children, and CodeExample.test.tsx / page.test.tsx
// stub `Example` out entirely (a plain `render(<Example ... />)` can't work
// here — @testing-library/react's client renderer cannot resolve an async
// component embedded as unresolved JSX; only a component that is *itself*
// async, called and awaited directly, can be resolved this way — the same
// technique `CodeBlock.test.tsx` uses for the other async component in this
// codebase).
//
// This file is the one place that actually renders the real
// registry -> loader -> toMarkdown -> shell pipeline for a real example id.
describe("Example (integration)", () => {
  it("renders the real streaming-chat-grid example's title, description, and files", async () => {
    const element = await Example({
      id: "streaming-chat-grid",
      initial: "code",
    });
    render(element);

    expect(screen.getByText("Streaming chat grid")).toBeInTheDocument();
    expect(
      screen.getByText(
        "Turn a streaming LLM response into rows with connectElementStream and append them to the grid as they arrive.",
      ),
    ).toBeInTheDocument();

    for (const filename of [
      "ChatGrid.tsx",
      "columns.ts",
      "response-events-to-chat-rows.ts",
    ]) {
      expect(screen.getByRole("tab", { name: filename })).toBeInTheDocument();
    }

    // Structural, not user-visible copy: the real export name from the real
    // ChatGrid.tsx, proving Shiki highlighted the actual file on disk rather
    // than a stub.
    const pane = document.querySelector(".pretable-example-code");
    expect(pane?.textContent).toContain("export function ChatGrid");
  });

  it("wires the real toMarkdown() output — including the derived .md URL — to Copy for agent", async () => {
    // Nothing else proves `agentMarkdown` (built by `toMarkdown(example)` in
    // Example.tsx) actually reaches a reader-facing surface: it never
    // appears in the DOM on its own, only as the payload a clipboard click
    // hands to `navigator.clipboard.writeText`.
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    const element = await Example({
      id: "streaming-chat-grid",
      initial: "code",
    });
    render(element);
    fireEvent.click(screen.getByRole("button", { name: /copy for agent/i }));
    expect(writeText).toHaveBeenCalledTimes(1);
    const copied = writeText.mock.calls[0][0] as string;
    expect(copied).toContain(
      "Source: https://pretable.ai/examples/streaming-chat-grid.md",
    );
  });

  it("offers a Preview tab, since streaming-chat-grid has a real demo", async () => {
    const element = await Example({ id: "streaming-chat-grid" });
    render(element);
    expect(screen.getByRole("tab", { name: "Preview" })).toBeInTheDocument();
  });
});
