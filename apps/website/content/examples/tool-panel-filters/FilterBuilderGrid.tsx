"use client";

import { PretableSurface, type PretableTelemetry } from "@pretable/react";
import { useCallback, useState } from "react";

import { columns } from "./columns";
import { holdings, type Holding } from "./data";

const VIEWPORT_HEIGHT = 380;

export function FilterBuilderGrid() {
  const [counts, setCounts] = useState({
    shown: holdings.length,
    total: holdings.length,
  });

  // `rowModelRowCount` is the post-filter row count; `visibleRowCount` would
  // be the viewport's, which changes when you scroll and says nothing about
  // the filter. Set through a value comparison so a telemetry publication
  // that did not move either number cannot re-render.
  const onTelemetryChange = useCallback((telemetry: PretableTelemetry) => {
    setCounts((current) =>
      current.shown === telemetry.rowModelRowCount &&
      current.total === telemetry.totalRowCount
        ? current
        : {
            shown: telemetry.rowModelRowCount,
            total: telemetry.totalRowCount,
          },
    );
  }, []);

  return (
    <div>
      <p style={{ margin: "0 0 8px", fontSize: 13 }}>
        The Filters pane is open on load. <strong>+ filter</strong> adds a
        condition on the first column — switch its picker to{" "}
        <strong>Sector</strong>, then open that header&apos;s funnel: the filter
        you just built is already in it, and one written there appears here.{" "}
        <strong>+ group</strong> nests a list, and the <strong>and</strong> /{" "}
        <strong>or</strong> button sets the connective for that whole list. A
        filter inside a group has no funnel to appear in — a funnel addresses
        only a top-level row.
      </p>
      {/*
        The query is deliberately uncontrolled — the panel writes filters
        straight into the engine, and the funnel writes into the same tree.
        Owning `query` here would put a third writer in the loop for no gain.
      */}
      <PretableSurface<Holding>
        ariaLabel="Holdings"
        columns={columns}
        getRowId={(row) => row.id}
        onTelemetryChange={onTelemetryChange}
        rows={holdings}
        toolPanel={{ defaultActiveSection: "filters" }}
        viewportHeight={VIEWPORT_HEIGHT}
      />
      <p style={{ margin: "8px 0 0", fontSize: 13 }}>
        Showing <code data-testid="filtered-row-count">{counts.shown}</code> of{" "}
        <code data-testid="total-row-count">{counts.total}</code> holdings.
      </p>
    </div>
  );
}
