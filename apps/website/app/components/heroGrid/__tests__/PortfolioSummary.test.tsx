// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { PortfolioSummary } from "../PortfolioSummary";
import type { PositionRow } from "../types";

function row(p: Partial<PositionRow> & { id: string }): PositionRow {
  return { symbol: p.id, name: p.id, sector: "Technology", qty: 0, last: 0,
    mktValue: 0, dayPnl: 0, dayPnlPct: 0, weight: 0, analyst: "", flag: "hold", ...p };
}

describe("PortfolioSummary", () => {
  const rows = [
    row({ id: "A", sector: "Technology", mktValue: 30_000_000, dayPnl: 200_000, flag: "risk", analyst: "x" }),
    row({ id: "B", sector: "Energy", mktValue: 18_240_000, dayPnl: 112_480, flag: "watch", analyst: "y" }),
  ];
  it("shows NAV as the summed market value", () => {
    render(<PortfolioSummary rows={rows} />);
    expect(screen.getByTestId("summary-nav")).toHaveTextContent("$48.2M");
  });
  it("shows total day P&L", () => {
    render(<PortfolioSummary rows={rows} />);
    expect(screen.getByTestId("summary-pnl")).toHaveTextContent("+$312,480");
  });
  it("lists flagged holdings as alerts", () => {
    render(<PortfolioSummary rows={rows} />);
    const alerts = screen.getAllByTestId("summary-alert");
    expect(alerts).toHaveLength(2);
    expect(alerts[0]).toHaveTextContent("A");
  });
});
