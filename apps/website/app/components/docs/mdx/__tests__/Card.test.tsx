import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { Card, CardGroup } from "../Card";

describe("Card", () => {
  it("renders link with title and description", () => {
    render(
      <Card title="Get started" href="/docs/getting-started">
        Body
      </Card>,
    );
    const link = screen.getByRole("link", { name: /Get started/i });
    expect(link).toHaveAttribute("href", "/docs/getting-started");
    expect(screen.getByText("Body")).toBeInTheDocument();
  });
});

describe("CardGroup", () => {
  it("renders children inside a grid container", () => {
    const { container } = render(
      <CardGroup cols={3}>
        <div>one</div>
      </CardGroup>,
    );
    expect(container.querySelector(".md\\:grid-cols-3")).not.toBeNull();
  });
});
