import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { defineExample } from "../../../../../lib/docs/define-example";
import { Example } from "../Example";

const def = defineExample({
  title: "Demo",
  Demo: <div>LIVE</div>,
  files: [
    { path: "a.ts", lang: "ts", source: "export const a = 1;" },
    { path: "b.ts", lang: "ts", source: "export const b = 2;" },
  ],
});

describe("Example", () => {
  it("renders live demo by default", () => {
    render(<Example example={def} />);
    expect(screen.getByText("LIVE")).toBeInTheDocument();
  });
  it("show source disclosure reveals tabs", () => {
    render(<Example example={def} />);
    fireEvent.click(screen.getByRole("button", { name: /show source/i }));
    expect(screen.getByRole("tab", { name: "a.ts" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "b.ts" })).toBeInTheDocument();
  });
  it("Copy all writes a fenced bundle", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    render(<Example example={def} defaultOpen />);
    fireEvent.click(screen.getByRole("button", { name: /copy all/i }));
    expect(writeText).toHaveBeenCalledWith(
      "```ts a.ts\nexport const a = 1;\n```\n\n```ts b.ts\nexport const b = 2;\n```\n",
    );
  });
});
