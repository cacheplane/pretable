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

it("renders the four positioning cards", () => {
  render(<ReceiptsBand />);
  expect(screen.getByText(/performance/i)).toBeInTheDocument();
  expect(screen.getByText(/ai-native/i)).toBeInTheDocument();
});

it("renders the problem callout", () => {
  render(<ReceiptsBand />);
  expect(screen.getByText(/clips wrapped content/i)).toBeInTheDocument();
});
