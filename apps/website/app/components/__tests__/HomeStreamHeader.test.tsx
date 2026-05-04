import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { ControlStateProvider } from "../heroGrid/controlState";
import { HomeStreamHeader } from "../HomeStreamHeader";

describe("HomeStreamHeader", () => {
  it("renders TopControlBar with the PRODUCTION tier active by default", () => {
    render(
      <ControlStateProvider>
        <HomeStreamHeader />
      </ControlStateProvider>,
    );
    // Default tier is PRODUCTION (60 ev/s) — its radio button should be the
    // checked one in the tier-group radiogroup.
    const productionTier = screen.getByRole("radio", { name: /production/i });
    expect(productionTier).toHaveAttribute("aria-checked", "true");
  });
});
