import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { Step, Steps } from "../Steps";

describe("Steps", () => {
  it("numbers each Step in order", () => {
    render(
      <Steps>
        <Step title="First">A body</Step>
        <Step title="Second">B body</Step>
      </Steps>,
    );
    expect(screen.getByText("First")).toBeInTheDocument();
    expect(screen.getByText("Second")).toBeInTheDocument();
    expect(screen.getByText("1")).toBeInTheDocument();
    expect(screen.getByText("2")).toBeInTheDocument();
  });
});
