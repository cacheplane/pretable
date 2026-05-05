import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { DocsShell } from "../DocsShell";

describe("DocsShell", () => {
  it("renders sidebar, main, toc slots", () => {
    render(
      <DocsShell sidebar={<div>SIDEBAR</div>} toc={<div>TOC</div>}>
        <div>MAIN</div>
      </DocsShell>,
    );
    expect(screen.getByText("SIDEBAR")).toBeInTheDocument();
    expect(screen.getByText("MAIN")).toBeInTheDocument();
    expect(screen.getByText("TOC")).toBeInTheDocument();
  });
});
