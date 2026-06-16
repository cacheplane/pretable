// @vitest-environment jsdom
import { render, screen, fireEvent } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { FilterSection } from "../sidebar/FilterSection";

describe("FilterSection", () => {
  it("emits search text changes", () => {
    const onSearch = vi.fn();
    render(<FilterSection search="" sector="All" onSearch={onSearch} onSector={vi.fn()} />);
    fireEvent.change(screen.getByPlaceholderText(/filter symbol/i), { target: { value: "nvda" } });
    expect(onSearch).toHaveBeenCalledWith("nvda");
  });
  it("emits sector chip selection", () => {
    const onSector = vi.fn();
    render(<FilterSection search="" sector="All" onSearch={vi.fn()} onSector={onSector} />);
    fireEvent.click(screen.getByRole("button", { name: "Energy" }));
    expect(onSector).toHaveBeenCalledWith("Energy");
  });
  it("marks the active sector chip", () => {
    render(<FilterSection search="" sector="Technology" onSearch={vi.fn()} onSector={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Technology" })).toHaveAttribute("aria-pressed", "true");
  });
});
