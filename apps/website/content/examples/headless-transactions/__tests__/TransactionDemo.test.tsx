import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { TransactionDemo } from "../TransactionDemo";

function taskTitles(): string[] {
  return screen
    .getAllByRole("row")
    .slice(1)
    .map((r) => within(r).getAllByRole("cell")[0]?.textContent ?? "");
}

describe("TransactionDemo", () => {
  it("renders the header plus all 4 seed tasks", () => {
    render(<TransactionDemo />);
    expect(screen.getAllByRole("row")).toHaveLength(5); // 1 header + 4
  });

  it("reports no batch applied before the button is clicked", () => {
    render(<TransactionDemo />);
    expect(screen.getByRole("status")).toHaveTextContent(
      "No batch applied yet.",
    );
  });

  it("applies add + update + remove as a single revision and reports the unknown-remove issue", () => {
    render(<TransactionDemo />);
    fireEvent.click(screen.getByRole("button", { name: /apply batch/i }));

    expect(screen.getByRole("status")).toHaveTextContent(
      "revision 0 → 1 · 1 added, 1 updated, 0 removed · 1 issue: unknown-remove-id (task-ghost)",
    );

    // The batch adds a new row.
    expect(taskTitles()).toContain("Follow-up 5");
    // One open task flipped to done.
    const doneRows = screen
      .getAllByRole("row")
      .slice(1)
      .filter((r) => within(r).getAllByRole("cell")[1]?.textContent === "done");
    expect(doneRows.length).toBeGreaterThanOrEqual(2); // task-3 was already done
  });

  it("advances the revision and adds a distinct row on each click", () => {
    render(<TransactionDemo />);
    const button = screen.getByRole("button", { name: /apply batch/i });
    fireEvent.click(button);
    fireEvent.click(button);

    expect(screen.getByRole("status")).toHaveTextContent("revision 1 → 2");
    expect(taskTitles()).toContain("Follow-up 5");
    expect(taskTitles()).toContain("Follow-up 6");
  });
});
