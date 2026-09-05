"use client";

import {
  PretableSurface,
  type PretableButtonComponent,
  type PretableColumn,
  type PretableIconButtonComponent,
} from "@pretable/react";
import { forwardRef } from "react";

/**
 * Test fixture for `apps/website/e2e/components.spec.ts`.
 *
 * The unit suite (`components-override.test.tsx`) proves the components
 * context resolves and reaches every site in jsdom. What only a real
 * browser can prove is that a replacement lands inside a popover the grid
 * PORTALS into `document.body` — the case the context exists for — and
 * that the grid's own behaviour on a replaced icon button (the menu it
 * anchors on the node, the focus it returns there) survives through the
 * forwarded ref. Both slots below are replaced with components that mark
 * themselves and record their `site`.
 *
 * Deliberately not part of the product surface; `fixtures/layout.tsx` keeps
 * the route out of search engines.
 */

interface Row {
  id: string;
  name: string;
  qty: number;
}

const ROWS: Row[] = [
  { id: "a", name: "Alpha", qty: 1 },
  { id: "b", name: "Bravo", qty: 2 },
  { id: "c", name: "Charlie", qty: 3 },
];

const COLUMNS: PretableColumn<Row>[] = [
  { id: "name", header: "Name", widthPx: 160, type: "text" },
  { id: "qty", header: "Qty", widthPx: 100, type: "number" },
];

const FixtureButton: PretableButtonComponent = forwardRef(
  function FixtureButton({ site, variant, ...props }, ref) {
    return (
      <button
        {...props}
        ref={ref}
        type="button"
        data-fixture-button={site ?? ""}
        data-fixture-variant={variant}
      />
    );
  },
);

const FixtureIconButton: PretableIconButtonComponent = forwardRef(
  function FixtureIconButton({ site, ...props }, ref) {
    return (
      <button
        {...props}
        ref={ref}
        type="button"
        data-fixture-icon={site ?? ""}
      />
    );
  },
);

export default function ComponentsFixturePage() {
  return (
    <main style={{ padding: 24 }}>
      <PretableSurface
        ariaLabel="components-fixture"
        columns={COLUMNS}
        components={{ Button: FixtureButton, IconButton: FixtureIconButton }}
        getRowId={(row) => row.id}
        rows={ROWS}
        toolPanel={{ defaultActiveSection: "columns" }}
        viewportHeight={240}
      />
    </main>
  );
}
