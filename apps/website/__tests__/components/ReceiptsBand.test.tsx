import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";

import { ReceiptsBand } from "../../app/components/ReceiptsBand";

afterEach(() => {
  cleanup();
});

it("renders the receipts band with content", () => {
  const { container } = render(<ReceiptsBand />);
  expect((container.textContent ?? "").trim().length).toBeGreaterThan(0);
});

it("renders the receipts headline numbers", () => {
  render(<ReceiptsBand />);
  // Quality-wedge anchor (post-B2 corrections): 0 blank gaps + 9ms frame p95.
  expect(screen.getByText("0")).toBeInTheDocument();
  expect(screen.getByText("9ms")).toBeInTheDocument();
});

it("does not render the positioning cards anymore (moved to CredibilityCards)", () => {
  render(<ReceiptsBand />);
  expect(screen.queryByText(/ai-native/i)).not.toBeInTheDocument();
  expect(screen.queryByText(/ecosystem/i)).not.toBeInTheDocument();
});

it("uses the inverted slate background (regression guard for the boldness pass)", () => {
  const { container } = render(<ReceiptsBand />);
  const section = container.querySelector("section#receipts");
  expect(section).toBeInTheDocument();
  expect(section?.className).toContain("bg-text-primary");
  expect(section?.className).toContain("text-bg-page");
});
