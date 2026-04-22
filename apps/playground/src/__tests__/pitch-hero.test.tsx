import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, test } from "vitest";

import { PitchHero } from "../pitch-hero";

afterEach(() => {
  cleanup();
});

describe("<PitchHero />", () => {
  test("renders the spec eyebrow, headline, and dek", () => {
    render(<PitchHero />);

    // Eyebrow (monospace, uppercase — content check only)
    expect(
      screen.getByText(
        /\$ pretable — read-heavy wedge · vol\. 1 · no\. 4/i,
      ),
    ).toBeInTheDocument();

    // Headline is an <h1>
    const headline = screen.getByRole("heading", { level: 1 });
    expect(headline).toBeInTheDocument();
    expect(headline).toHaveTextContent(/scroll/i);

    // Italic amber emphasis on "scroll"
    const em = within(headline).getByText("scroll");
    expect(em.tagName).toBe("EM");
  });

  test("dek contains at least one Receipt tag", () => {
    render(<PitchHero />);

    // <Receipt> from @pretable/ui renders a <span class="pt-receipt">
    const receipts = document.querySelectorAll(".pt-receipt");
    expect(receipts.length).toBeGreaterThan(0);
  });

  test("renders CTA 1 as an anchor to #grid", () => {
    render(<PitchHero />);

    const tryLink = screen.getByRole("link", {
      name: /try the live playground/i,
    });
    expect(tryLink).toHaveAttribute("href", "#grid");
  });

  test("renders CTA 2 as a CopyCommand for npm i @pretable/react", () => {
    render(<PitchHero />);

    const copyBtn = screen.getByRole("button", {
      name: /copy install command/i,
    });
    expect(copyBtn).toHaveTextContent("$ npm i @pretable/react");
  });
});
