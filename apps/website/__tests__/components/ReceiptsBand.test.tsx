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
  expect(screen.getByText("4×")).toBeInTheDocument();
  expect(screen.getByText("16ms")).toBeInTheDocument();
});

it("does not render the positioning cards anymore (moved to CredibilityCards)", () => {
  render(<ReceiptsBand />);
  expect(screen.queryByText(/ai-native/i)).not.toBeInTheDocument();
  expect(screen.queryByText(/ecosystem/i)).not.toBeInTheDocument();
});
