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
        screen.getByRole("button", { name: /filter 150,000 orders/i }),
      );

      await waitFor(
        () => {
          expect(status).toHaveTextContent("Ready.");
          // The filter landed: only the 30,000 west-region orders survive,
          // and every preview row is one of them.
          expect(screen.getByText(/30,000 rows indexed/)).toBeInTheDocument();
        },
        { timeout: REBUILD_TIMEOUT },
      );

      observer.disconnect();
      // Proves the rebuild actually published at least one intermediate
      // `rebuilding` slice before landing on `ready` — the whole reason this
      // example exists. On the small 75-row custom-renderer example this
      // would be a coin flip; at 150,000 rows it is not. A sort-only change
      // could never pass this: on ungrouped data it settles synchronously
      // with no `rebuilding` phase at all.
      expect(sawRebuilding).toBe(true);

      const previewRows = screen.getAllByRole("row").slice(1);
      expect(previewRows.length).toBeGreaterThan(0);
      for (const row of previewRows) {
        expect(row).toHaveTextContent("west");
      }
    },
    REBUILD_TIMEOUT + 5_000,
  );

  it(
    "clears the filter cooperatively on the second click",
    async () => {
      render(<RebuildProgressDemo />);
      await waitFor(() => screen.getByText(/150,000 rows indexed/), {
        timeout: REBUILD_TIMEOUT,
      });

      fireEvent.click(
        screen.getByRole("button", { name: /filter 150,000 orders/i }),
      );
      await waitFor(
        () => screen.getByText(/30,000 rows indexed/),
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

      fireEvent.click(
        screen.getByRole("button", { name: /show all 150,000 orders/i }),
      );

      await waitFor(
        () => {
          expect(status).toHaveTextContent("Ready.");
          expect(screen.getByText(/150,000 rows indexed/)).toBeInTheDocument();
        },
        { timeout: REBUILD_TIMEOUT },
      );

      observer.disconnect();
      // Removing a filter re-runs the same cooperative path over all
      // 150,000 source rows, so the toggle demonstrates progress in both
      // directions.
      expect(sawRebuilding).toBe(true);
    },
    REBUILD_TIMEOUT + 5_000,
  );
});
