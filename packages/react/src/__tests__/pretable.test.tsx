import "@testing-library/jest-dom/vitest";
import { render, screen } from "@testing-library/react";
import { expect, it } from "vitest";

import { Pretable } from "../index";

it("renders a placeholder label", () => {
  render(<Pretable rows={[]} columns={[]} />);

  expect(screen.getByText("Pretable React adapter")).toBeInTheDocument();
});
