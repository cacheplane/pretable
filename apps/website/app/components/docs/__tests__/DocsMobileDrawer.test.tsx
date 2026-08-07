import { fireEvent, render, screen } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
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

  it("reports data-hydrated='false' in the server-rendered markup", () => {
    // The SSR contract the e2e `waitForDocsReady` helper waits on: the button
    // paints from this markup with no click handler attached, and says so.
    const html = renderToStaticMarkup(
      <DocsMobileDrawer>
        <div>content</div>
      </DocsMobileDrawer>,
    );
    expect(html).toContain('data-hydrated="false"');
  });

  it("reports data-hydrated='true' once mounted on the client", () => {
    render(
      <DocsMobileDrawer>
        <div>content</div>
      </DocsMobileDrawer>,
    );
    expect(screen.getByRole("button", { name: /menu/i })).toHaveAttribute(
      "data-hydrated",
      "true",
    );
  });
});
