import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";

import { CtaSection } from "../../app/components/CtaSection";

afterEach(() => {
  cleanup();
});

it("renders the install command as primary CTA", () => {
  render(<CtaSection />);
  expect(screen.getByText("npm install @pretable/react")).toBeInTheDocument();
});

it("renders a GitHub link as secondary CTA", () => {
  render(<CtaSection />);
  const link = screen.getByRole("link", { name: /github/i });
  expect(link.getAttribute("href")).toContain("github.com");
});
