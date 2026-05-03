import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { CredibilityCards } from "../../app/components/CredibilityCards";

describe("CredibilityCards", () => {
  afterEach(() => cleanup());

  it("renders all four positioning cards by eyebrow", () => {
    render(<CredibilityCards />);
    expect(screen.getByText(/performance/i)).toBeInTheDocument();
    expect(screen.getByText(/ai-native/i)).toBeInTheDocument();
    expect(screen.getByText(/wrapped text/i)).toBeInTheDocument();
    expect(screen.getByText(/ecosystem/i)).toBeInTheDocument();
  });

  it("renders the section eyebrow '02 · why it works'", () => {
    render(<CredibilityCards />);
    expect(screen.getByText(/02 · why it works/i)).toBeInTheDocument();
  });
});
