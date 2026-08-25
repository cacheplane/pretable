import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { RebuildProgressDemo } from "../RebuildProgressDemo";

// A 150,000-row rebuild genuinely takes real wall-clock time — that is the
// entire point of this example — so this budget is generous on purpose, the
// same way HeadlessTable.test.tsx's is. See that file's comment for why a
// wall-clock wait is the honest thing to assert here, not a performance
// gate.
const REBUILD_TIMEOUT = 30_000;

describe("RebuildProgressDemo", () => {
  it("renders the initial indexed count", async () => {
    render(<RebuildProgressDemo />);
    await waitFor(
      () => {
        expect(screen.getByText(/150,000 rows indexed/)).toBeInTheDocument();
      },
      { timeout: REBUILD_TIMEOUT },
    );
  });

  it(
    "cycles the progress readout through rebuilding before landing on ready",
    async () => {
      render(<RebuildProgressDemo />);
      await waitFor(() => screen.getByText(/150,000 rows indexed/), {
        timeout: REBUILD_TIMEOUT,
      });

      let sawRebuilding = false;
      const status = screen.getByRole("status");
      const observer = new MutationObserver(() => {
        if (/Rebuilding…/.test(status.textContent ?? "")) {
          sawRebuilding = true;
        }
      });
      observer.observe(status, {
        childList: true,
        characterData: true,
        subtree: true,
      });

      fireEvent.click(
        screen.getByRole("button", { name: /group 150,000 orders/i }),
      );

      await waitFor(
        () => {
          expect(status).toHaveTextContent("Ready.");
        },
        { timeout: REBUILD_TIMEOUT },
      );

      observer.disconnect();
      // Proves the rebuild actually published at least one intermediate
      // `rebuilding` slice before landing on `ready` — the whole reason this
      // example exists. On the small 75-row custom-renderer example this
      // would be a coin flip; at 150,000 rows it is not. A sort-only or
      // filter-only change could never pass this: on ungrouped data both
      // settle synchronously with no `rebuilding` phase at all. Grouping is
      // the one change vehicle that is cooperative by design, not omission.
      expect(sawRebuilding).toBe(true);

      // The grouping landed: every visible region group has surfaced as its
      // own row (5 regions), distinct from the plain data rows.
      const previewRows = screen.getAllByRole("row").slice(1);
      expect(previewRows.length).toBeGreaterThan(0);
      const groupRows = previewRows.filter((row) =>
        /\(\d+\)/.test(row.textContent ?? ""),
      );
      expect(groupRows.length).toBeGreaterThan(0);

      // Group rows sit alongside the 150,000 data rows in the indexed
      // count, so it goes up, not down, once grouping lands.
      const rowsIndexedText = screen.getByText(/rows indexed/).textContent;
      const indexedCount = Number(
        rowsIndexedText
          ?.match(/^([\d,]+) rows indexed/)?.[1]
          ?.replace(/,/g, ""),
      );
      expect(indexedCount).toBeGreaterThan(150_000);
    },
    REBUILD_TIMEOUT + 5_000,
  );

  it(
    "ungroups cooperatively on the second click",
    async () => {
      render(<RebuildProgressDemo />);
      await waitFor(() => screen.getByText(/150,000 rows indexed/), {
        timeout: REBUILD_TIMEOUT,
      });

      fireEvent.click(
        screen.getByRole("button", { name: /group 150,000 orders/i }),
      );
      await waitFor(
        () => {
          const status = screen.getByRole("status");
          expect(status).toHaveTextContent("Ready.");
        },
        { timeout: REBUILD_TIMEOUT },
      );

      let sawRebuilding = false;
      const status = screen.getByRole("status");
      const observer = new MutationObserver(() => {
        if (/Rebuilding…/.test(status.textContent ?? "")) {
          sawRebuilding = true;
        }
      });
      observer.observe(status, {
        childList: true,
        characterData: true,
        subtree: true,
      });

      fireEvent.click(screen.getByRole("button", { name: /ungroup/i }));

      await waitFor(
        () => {
          expect(status).toHaveTextContent("Ready.");
          expect(screen.getByText(/150,000 rows indexed/)).toBeInTheDocument();
        },
        { timeout: REBUILD_TIMEOUT },
      );

      observer.disconnect();
      // Removing the grouping re-runs the same cooperative path over all
      // 150,000 source rows, so the toggle demonstrates progress in both
      // directions.
      expect(sawRebuilding).toBe(true);

      // Ungrouped: no group rows remain, only plain data rows.
      const previewRows = screen.getAllByRole("row").slice(1);
      const groupRows = previewRows.filter((row) =>
        /\(\d+\)/.test(row.textContent ?? ""),
      );
      expect(groupRows.length).toBe(0);
    },
    REBUILD_TIMEOUT + 5_000,
  );
});
