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

  test("renders a telemetry readout with 'rendered 0 · sel none' before any grid activity", () => {
    render(<PitchGrid />);
    const strip = screen.getByTestId("pitch-grid-chrome");
    expect(strip).toHaveTextContent(/rendered 0/i);
    expect(strip).toHaveTextContent(/sel none/i);
  });

  test("renders filter inputs for each filterable column", () => {
    render(<PitchGrid />);

    const filterBar = screen.getByTestId("pitch-grid-filters");
    const inputs = within(filterBar).getAllByRole("textbox");
    expect(inputs.length).toBeGreaterThan(0);
  });

  test("changing the scale select re-derives the dataset (placeholder check via rendered row count after wiring)", () => {
    // Full behavioral check lives in Task 6 (requires InspectionGrid integration).
    // Here we just assert the scale select fires its onChange without throwing.
    render(<PitchGrid />);
    const scaleSelect = screen.getByLabelText("Dataset scale");
    fireEvent.change(scaleSelect, { target: { value: "tiny" } });
    expect(scaleSelect).toHaveValue("tiny");
  });
});
