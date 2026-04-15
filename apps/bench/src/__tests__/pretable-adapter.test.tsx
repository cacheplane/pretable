import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, test, vi } from "vitest";

import { createScenarioDataset } from "@pretable-internal/scenario-data";
import * as pretableReactInternal from "@pretable/react/internal";

import { PretableAdapter } from "../pretable-adapter";

describe("PretableAdapter", () => {
  afterEach(() => {
    cleanup();
  });

  test("keeps the shared renderer contract with raw body values and label-only headers", () => {
    const dataset = createScenarioDataset("S2", { scale: "smoke" });
    const firstRowValue = String(dataset.rows[0]?.col_0 ?? "");

    render(<PretableAdapter dataset={dataset} runKey={1} />);

    const adapter = screen
      .getByRole("grid", { name: "Pretable React adapter" })
      .closest("[data-benchmark-adapter]");
    const headerButton = screen.getByRole("button", {
      name: "Sort Message 1",
    });
    const firstRow = screen.getAllByTestId("pretable-row")[0];

    expect(adapter).toHaveAttribute("data-benchmark-adapter", "pretable");
    expect(adapter?.querySelector("[data-pretable-scroll-viewport]")).toBeTruthy();
    expect(adapter?.querySelector("[data-pretable-row]")).toBeTruthy();
    expect(headerButton).toHaveTextContent("Message 1");
    expect(headerButton).not.toHaveTextContent("Sort");
    expect(within(firstRow).queryByText("Message 1")).not.toBeInTheDocument();
    expect(within(firstRow).queryByText("Owner 1")).not.toBeInTheDocument();
    expect(within(firstRow).getByText(firstRowValue)).toBeInTheDocument();
  });

  test("marks wrapped benchmark cells so row-height measurement can stay scoped", () => {
    const dataset = createScenarioDataset("S2", { scale: "smoke" });

    render(<PretableAdapter dataset={dataset} runKey={1} />);

    const firstWrappedCell = screen
      .getAllByTestId("pretable-row")[0]
      ?.querySelector('[data-pretable-cell][data-pretable-wrap="true"]');

    expect(firstWrappedCell).toBeTruthy();
  });

  test("uses a tighter benchmark overscan than the playground-oriented default", () => {
    const dataset = createScenarioDataset("S2", { scale: "smoke" });
    const surfaceSpy = vi.spyOn(pretableReactInternal, "PretableSurface");

    render(<PretableAdapter dataset={dataset} runKey={1} />);

    expect(surfaceSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        overscan: 4,
      }),
      undefined,
    );
  });
});
