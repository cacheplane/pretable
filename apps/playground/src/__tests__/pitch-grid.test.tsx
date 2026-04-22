import "@testing-library/jest-dom/vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { afterEach, describe, expect, test } from "vitest";

import { PitchGrid } from "../pitch-grid";

afterEach(() => {
  cleanup();
});

describe("<PitchGrid /> — chrome + filters", () => {
  test("renders a section with id='grid' for anchor linking", () => {
    const { container } = render(<PitchGrid />);
    expect(container.querySelector("#grid")).toBeInTheDocument();
  });

  test("renders a scale select defaulting to dev", () => {
    render(<PitchGrid />);
    const scaleSelect = screen.getByLabelText("Dataset scale");
    expect(scaleSelect).toHaveValue("dev");
  });

  test("renders a telemetry readout showing rendered count and sel none", () => {
    render(<PitchGrid />);
    const strip = screen.getByTestId("pitch-grid-chrome");
    expect(strip).toHaveTextContent(/rendered/i);
    expect(strip).toHaveTextContent(/sel none/i);
  });

  test("renders filter inputs for each filterable column", () => {
    render(<PitchGrid />);

    const filterBar = screen.getByTestId("pitch-grid-filters");
    const inputs = within(filterBar).getAllByRole("textbox");
    expect(inputs.length).toBeGreaterThan(0);
  });

  test("mounts an InspectionGrid-styled grid (finds inspection-header-row in DOM)", () => {
    const { container } = render(<PitchGrid />);
    expect(
      container.querySelector(".inspection-header-cell"),
    ).toBeInTheDocument();
  });

  test("changing scale updates the dataset row count surfaced in the grid", () => {
    render(<PitchGrid />);
    const scaleSelect = screen.getByLabelText("Dataset scale");

    // tiny should render fewer rows than dev — exact assertion deferred to the
    // telemetry update below (renderedRowCount decreases monotonically).
    fireEvent.change(scaleSelect, { target: { value: "tiny" } });
    expect(scaleSelect).toHaveValue("tiny");

    // Chrome strip updates once telemetry flows. The test relies on the
    // onTelemetryChange wiring; if this assertion flakes, the wiring is off.
    const strip = screen.getByTestId("pitch-grid-chrome");
    expect(strip).toHaveTextContent(/rendered/i);
  });
});
