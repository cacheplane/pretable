import {
  render,
  screen,
  fireEvent,
  waitFor,
  within,
} from "@testing-library/react";
import { Profiler } from "react";
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

  it("filters rows by team", async () => {
    render(<HeadlessTable />);
    fireEvent.change(screen.getByLabelText(/filter by team/i), {
      target: { value: "payments" },
    });
    // The budget is generous on purpose. `setQuery` yields between slices, so
    // when it settles is the host's decision, not the model's: measured here,
    // the model needs ~4ms of work but one scheduler hop can stall ~330ms while
    // the other suite workers hold the cores. That is what a wall-clock budget
    // can honestly assert — that the update lands at all. What it must NOT be
    // is a de-facto performance gate, which is what the default 1s budget
    // silently became: the per-slice repaint below cost ~1.9s here and turned
    // this assertion red in CI. The render count pins that cost; this waits.
    await waitFor(
      () => {
        const rows = screen.getAllByRole("row").slice(1);
        expect(rows.length).toBe(15); // 75 / 5 teams
      },
      { timeout: 15_000 },
    );
  });

  it("does not repaint the table on every transition slice", async () => {
    // `setQuery` settles cooperatively: the model publishes a new state object
    // per slice carrying `rebuilding` progress, while `snapshot` stays the same
    // object until the swap. A consumer that subscribes to the whole state
    // therefore re-renders every row on each slice for no visual change — five
    // wasted full-table renders here, ~100ms each in jsdom, which is what used
    // to push this file's filter assertion past its one-second budget.
    //
    // Subscribing to `snapshot` instead lets useSyncExternalStore bail out on
    // identity, so the table commits once for the settled result.
    let commits = 0;
    render(
      <Profiler id="headless" onRender={() => (commits += 1)}>
        <HeadlessTable />
      </Profiler>,
    );
    commits = 0;
    fireEvent.change(screen.getByLabelText(/filter by team/i), {
      target: { value: "payments" },
    });
    await waitFor(
      () => {
        expect(screen.getAllByRole("row").slice(1).length).toBe(15);
      },
      { timeout: 15_000 },
    );
    expect(commits).toBe(1);
  });

  it("marks a row selected when clicked", () => {
    render(<HeadlessTable />);
    const firstBodyRow = screen.getAllByRole("row")[1];
    fireEvent.click(firstBodyRow);
    expect(firstBodyRow).toHaveAttribute("aria-selected", "true");
  });
});
