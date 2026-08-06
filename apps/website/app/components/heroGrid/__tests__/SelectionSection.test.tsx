// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { SelectionSection } from "../sidebar/SelectionSection";

describe("SelectionSection", () => {
  it("renders nothing when there is no summary", () => {
    const { container } = render(
      <SelectionSection summary={null} copied={false} />,
    );
    expect(container).toBeEmptyDOMElement();
  });
  it("shows rows × cols and the copy hint", () => {
    render(<SelectionSection summary={{ rows: 3, cols: 2 }} copied={false} />);
    expect(screen.getByText(/3 × 2 selected/i)).toBeInTheDocument();
    expect(screen.getByText(/⌘C to copy/i)).toBeInTheDocument();
  });
  it("shows Copied ✓ after a copy", () => {
    render(<SelectionSection summary={{ rows: 1, cols: 1 }} copied={true} />);
    expect(screen.getByText(/copied/i)).toBeInTheDocument();
  });
  it("reports a paste even when nothing is selected", () => {
    render(
      <SelectionSection
        summary={null}
        copied={false}
        paste={{ applied: 2, total: 4, rejected: 2, clippedRows: 1 }}
      />,
    );
    expect(screen.getByTestId("paste-summary")).toHaveTextContent(
      "Pasted 2 of 4 · 2 rejected · 1 rows past the end",
    );
  });
  it("omits the rejected and clipped clauses when there are none", () => {
    render(
      <SelectionSection
        summary={null}
        copied={false}
        paste={{ applied: 3, total: 3, rejected: 0, clippedRows: 0 }}
      />,
    );
    expect(screen.getByTestId("paste-summary")).toHaveTextContent(
      "Pasted 3 of 3",
    );
    expect(screen.queryByText(/rejected/i)).not.toBeInTheDocument();
  });
});
