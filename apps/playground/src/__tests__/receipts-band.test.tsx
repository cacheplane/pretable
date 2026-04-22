import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, test } from "vitest";

import { ReceiptsBand } from "../receipts-band";

afterEach(() => {
  cleanup();
});

describe("<ReceiptsBand />", () => {
  test("renders the section header with italic 'Receipts' emphasis", () => {
    render(<ReceiptsBand />);
    const heading = screen.getByRole("heading", { level: 2 });
    expect(heading).toHaveTextContent(/receipts/i);
    expect(heading).toHaveTextContent(/, not claims\./i);
  });

  test("renders four stats in order with values and captions", () => {
    render(<ReceiptsBand />);

    const stats = screen.getAllByRole("listitem");
    expect(stats).toHaveLength(4);

    expect(stats[0]).toHaveTextContent(/500k/i);
    expect(stats[0]).toHaveTextContent(/rows rendered/i);

    expect(stats[1]).toHaveTextContent(/2\.4ms/i);
    expect(stats[1]).toHaveTextContent(/frame p50/i);

    // Relaxed from plan's /^0$|^0\s/ — sibling <div> textContent is "0jank events"
    // with no whitespace between children, so the stricter regex never matches.
    // /^0/ still distinguishes "0" from "10"/"100" which would start with "1".
    expect(stats[2]).toHaveTextContent(/^0/);
    expect(stats[2]).toHaveTextContent(/jank events/i);

    expect(stats[3]).toHaveTextContent(/4\.1×/i);
    expect(stats[3]).toHaveTextContent(/vs ag-grid/i);
  });

  test("renders a link to the bench", () => {
    render(<ReceiptsBand />);
    const link = screen.getByRole("link", {
      name: /see them re-run in the bench/i,
    });
    expect(link).toHaveAttribute("href", "/bench");
  });
});
