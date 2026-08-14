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
        screen.getByRole("button", { name: /sort 150,000 orders/i }),
      );

      await waitFor(
        () => {
          expect(status).toHaveTextContent("Sorted.");
        },
        { timeout: REBUILD_TIMEOUT },
      );

      observer.disconnect();
      // Proves the rebuild actually published at least one intermediate
      // `rebuilding` slice before landing on `ready` — the whole reason this
      // example exists. On the small 75-row custom-renderer example this
      // would be a coin flip; at 150,000 rows it is not.
      expect(sawRebuilding).toBe(true);
    },
    REBUILD_TIMEOUT + 5_000,
  );
});
