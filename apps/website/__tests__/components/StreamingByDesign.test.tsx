import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { StreamingByDesign } from "../../app/components/StreamingByDesign";

describe("StreamingByDesign", () => {
  afterEach(() => cleanup());

  it("renders the eyebrow '05 · streaming, by design'", () => {
    render(<StreamingByDesign />);
    expect(screen.getByText(/05 · streaming, by design/i)).toBeInTheDocument();
  });

  it("renders the h2 with 'streaming-first' and an italic 'Not bolted-on.'", () => {
    render(<StreamingByDesign />);
    const h2 = screen.getByRole("heading", { level: 2 });
    expect(h2.textContent ?? "").toMatch(/built streaming-first/i);
    expect(h2.textContent ?? "").toMatch(/not bolted-on/i);
    const em = h2.querySelector("em");
    expect(em).toBeInTheDocument();
    expect(em?.textContent ?? "").toMatch(/not bolted-on/i);
  });

  it("renders both card headings", () => {
    render(<StreamingByDesign />);
    expect(
      screen.getByRole("heading", { level: 3, name: /one shape, one path/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", {
        level: 3,
        name: /selection survives every patch/i,
      }),
    ).toBeInTheDocument();
  });

  it("card 1 body mentions applyTransaction", () => {
    const { container } = render(<StreamingByDesign />);
    expect(container.textContent ?? "").toMatch(/applyTransaction/);
  });

  it("card 2 body mentions row-id", () => {
    const { container } = render(<StreamingByDesign />);
    expect(container.textContent ?? "").toMatch(/row-id/i);
  });

  it("renders an api-reference link to /docs/streaming", () => {
    render(<StreamingByDesign />);
    const link = screen.getByRole("link", { name: /api reference/i });
    expect(link).toHaveAttribute("href", "/docs/streaming");
  });
});
