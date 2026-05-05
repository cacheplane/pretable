import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { DocsSearch } from "../DocsSearch";

describe("DocsSearch", () => {
  it("opens on Cmd+K, closes on Esc", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      json: () =>
        Promise.resolve([
          {
            slug: "/docs/g",
            title: "Grid",
            description: "d",
            nav: "Grid",
            headings: [],
            body: "",
          },
        ]),
    }) as unknown as typeof fetch;
    render(<DocsSearch />);
    fireEvent.keyDown(window, { key: "k", metaKey: true });
    await waitFor(() => expect(screen.getByRole("dialog")).toBeInTheDocument());
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
  it("filters results by title match", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      json: () =>
        Promise.resolve([
          {
            slug: "/docs/streaming",
            title: "Streaming",
            description: "d",
            nav: "Streaming",
            headings: [],
            body: "",
          },
          {
            slug: "/docs/theming",
            title: "Theming",
            description: "d",
            nav: "Theming",
            headings: [],
            body: "",
          },
        ]),
    }) as unknown as typeof fetch;
    render(<DocsSearch />);
    fireEvent.keyDown(window, { key: "k", metaKey: true });
    const input = await screen.findByRole("combobox");
    fireEvent.change(input, { target: { value: "stream" } });
    expect(
      await screen.findByRole("link", { name: /Streaming/ }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("link", { name: /Theming/ }),
    ).not.toBeInTheDocument();
  });
});
