import { render, screen, fireEvent, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { HeadlessTable } from "../HeadlessTable";

function dataRowNames(): string[] {
  // First column cell text of each body row (excludes the header row).
  return screen
    .getAllByRole("row")
    .slice(1)
    .map((r) => within(r).getAllByRole("cell")[0].textContent ?? "");
}

describe("HeadlessTable", () => {
  it("renders the header plus all 75 rows", () => {
    render(<HeadlessTable />);
    expect(screen.getAllByRole("row")).toHaveLength(76); // 1 header + 75
  });

  it("sorts by latency ascending when the Latency header is clicked", () => {
    render(<HeadlessTable />);
    fireEvent.click(screen.getByRole("button", { name: /latency/i }));
    const names = dataRowNames();
    // svc-0 has the lowest latency (20ms) so it sorts to the top.
    expect(names[0]).toBe("service-00");
  });

  it("filters rows by team", () => {
    render(<HeadlessTable />);
    fireEvent.change(screen.getByLabelText(/filter by team/i), {
      target: { value: "payments" },
    });
    const rows = screen.getAllByRole("row").slice(1);
    expect(rows.length).toBe(15); // 75 / 5 teams
    expect(rows.length).toBeGreaterThan(0);
  });

  it("marks a row selected when clicked", () => {
    render(<HeadlessTable />);
    const firstBodyRow = screen.getAllByRole("row")[1];
    fireEvent.click(firstBodyRow);
    expect(firstBodyRow).toHaveAttribute("aria-selected", "true");
  });
});
