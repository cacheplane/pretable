import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { Tab, Tabs } from "../Tabs";

describe("Tabs", () => {
  it("shows first tab by default and switches on click", () => {
    render(
      <Tabs>
        <Tab label="One">body-one</Tab>
        <Tab label="Two">body-two</Tab>
      </Tabs>,
    );
    expect(screen.getByText("body-one")).toBeInTheDocument();
    expect(screen.queryByText("body-two")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("tab", { name: "Two" }));
    expect(screen.getByText("body-two")).toBeInTheDocument();
  });
});
