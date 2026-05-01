import { cleanup, render } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";

import { ReceiptsBand } from "../../app/components/ReceiptsBand";

afterEach(() => {
  cleanup();
});

it("renders the receipts band with content", () => {
  const { container } = render(<ReceiptsBand />);
  expect((container.textContent ?? "").trim().length).toBeGreaterThan(0);
});
