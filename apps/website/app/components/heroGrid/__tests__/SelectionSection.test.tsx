// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { SelectionSection } from "../sidebar/SelectionSection";

describe("SelectionSection", () => {
  it("renders nothing when there is no summary", () => {
    const { container } = render(<SelectionSection summary={null} copied={false} />);
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
});
