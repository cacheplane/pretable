import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, test } from "vitest";

import { StreamingProof } from "../streaming-proof";

afterEach(() => {
  cleanup();
});

describe("<StreamingProof />", () => {
  test("renders the wedge label and section heading", () => {
    render(<StreamingProof />);
    expect(screen.getByText(/wedge.*streaming/i)).toBeInTheDocument();
    const heading = screen.getByRole("heading", { level: 2 });
    expect(heading).toHaveTextContent(/stream/i);
    expect(heading).toHaveTextContent(/tokens/i);
    expect(heading).toHaveTextContent(/500 rows/i);
  });

  test("renders the three H13 metrics in order", () => {
    render(<StreamingProof />);
    const metrics = screen.getAllByRole("listitem");
    expect(metrics).toHaveLength(3);

    expect(metrics[0]).toHaveTextContent(/9ms/i);
    expect(metrics[0]).toHaveTextContent(/frame p95/i);

    expect(metrics[1]).toHaveTextContent(/^0/);
    expect(metrics[1]).toHaveTextContent(/long tasks/i);

    expect(metrics[2]).toHaveTextContent(/1k\/s/i);
    expect(metrics[2]).toHaveTextContent(/updates sustained/i);
  });

  test("renders a link to the streaming demo", () => {
    render(<StreamingProof />);
    const link = screen.getByRole("link", { name: /watch it stream/i });
    expect(link).toHaveAttribute("href", "/streaming/");
  });
});
