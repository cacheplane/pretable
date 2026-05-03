import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { ControlStateProvider } from "../heroGrid/controlState";
import { HomeStreamHeader } from "../HomeStreamHeader";

describe("HomeStreamHeader", () => {
  it("renders TopControlBar with default 1,000 ev/s", () => {
    render(
      <ControlStateProvider>
        <HomeStreamHeader />
      </ControlStateProvider>,
    );
    expect(screen.getByText(/1,000/)).toBeInTheDocument();
  });
});
