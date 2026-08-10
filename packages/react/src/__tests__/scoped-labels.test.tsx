import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import * as React from "react";
import { afterEach, describe, expect, it } from "vitest";

import { PretableSurface } from "../pretable-surface";
import type { PretableSurfaceMessages } from "../pretable-surface";

afterEach(cleanup);

type Row = { id: string; name: string };

const rows: Row[] = [
  { id: "a", name: "Ada" },
  { id: "b", name: "Bob" },
];

const columns = [{ id: "name", header: "Name", widthPx: 120 }];

function renderSurface(props: {
  external?: boolean;
  total?: number;
  messages?: PretableSurfaceMessages;
}) {
  return render(
    <PretableSurface<Row>
      ariaLabel="People"
      columns={columns}
      rows={rows}
      getRowId={(row) => row.id}
      viewportHeight={400}
      rowSelectionColumn={{ enabled: true }}
      messages={props.messages}
      processing={
        props.external ? { filter: "external", sort: "external" } : undefined
      }
      resultMeta={
        props.total === undefined
          ? undefined
          : { total: { kind: "exact", count: props.total } }
      }
    />,
  );
}

describe("scoped select-all labeling", () => {
  it('says "Select all rows" in local mode', () => {
    renderSurface({});
    expect(
      screen.getByRole("checkbox", { name: "Select all rows" }),
    ).toBeInTheDocument();
  });

  it('says "Select all loaded rows" when the window is partial', () => {
    renderSurface({ external: true, total: 5432 });
    expect(
      screen.getByRole("checkbox", { name: "Select all loaded rows" }),
    ).toBeInTheDocument();
  });

  it('says "Select all rows" when the window IS the whole population', () => {
    renderSurface({ external: true, total: 2 });
    expect(
      screen.getByRole("checkbox", { name: "Select all rows" }),
    ).toBeInTheDocument();
  });

  it("passes scope and counts to selectAllAnnouncement", () => {
    const seen: unknown[] = [];
    renderSurface({
      external: true,
      total: 5432,
      messages: {
        selectAllAnnouncement: (args) => {
          seen.push(args);
          return "ok";
        },
      },
    });
    fireEvent.click(
      screen.getByRole("checkbox", { name: "Select all loaded rows" }),
    );
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({
      scope: "loaded",
      loadedCount: 2,
      total: 5432,
      isAll: true,
    });
  });
});
