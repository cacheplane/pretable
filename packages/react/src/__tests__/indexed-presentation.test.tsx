import "@testing-library/jest-dom/vitest";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { Pretable, PretableSurface } from "../public_api";
import type { PretableColumn } from "../types";

type Row = { key: string; amount: number };

const rows: Row[] = [{ key: "stable-a", amount: 1234.5 }];
const columns: PretableColumn<Row>[] = [
  {
    id: "amount",
    type: "number",
    numberFormat: { style: "currency", currency: "USD" },
  },
];

describe("indexed presentation integration", () => {
  it("formats raw indexed values with the configured locale", () => {
    const view = render(
      <PretableSurface
        ariaLabel="Amounts"
        columns={columns}
        getRowId={(row) => row.key}
        locale="en-US"
        rows={rows}
        viewportHeight={200}
      />,
    );

    expect(
      view.container.querySelector('[data-pretable-column-id="amount"]'),
    ).toHaveAttribute("data-pretable-column-align", "end");
    expect(view.container).toHaveTextContent("$1,234.50");
  });

  it("uses the required identity accessor rather than a positional fallback", () => {
    render(
      <Pretable
        ariaLabel="Amounts"
        columns={columns}
        getRowId={(row) => row.key}
        rows={rows}
      />,
    );
    expect(screen.getAllByText("$1,234.50")).not.toHaveLength(0);
  });
});
