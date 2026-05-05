import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { DocsMobileDrawer } from "../DocsMobileDrawer";

describe("DocsMobileDrawer", () => {
  it("opens via button, closes via Esc", () => {
    render(
      <DocsMobileDrawer>
        <div>content</div>
      </DocsMobileDrawer>,
    );
    const btn = screen.getByRole("button", { name: /menu/i });
    fireEvent.click(btn);
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});
