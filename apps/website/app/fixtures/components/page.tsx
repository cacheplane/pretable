"use client";

import {
  PretableSurface,
  type PretableButtonComponent,
  type PretableCheckboxComponent,
  type PretableColumn,
  type PretableIconButtonComponent,
  type PretableSelectComponent,
  type PretableTextInputComponent,
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
  status: string;
}

const ROWS: Row[] = [
  { id: "a", name: "Alpha", qty: 1, status: "open" },
  { id: "b", name: "Bravo", qty: 2, status: "closed" },
  { id: "c", name: "Charlie", qty: 3, status: "open" },
];

const COLUMNS: PretableColumn<Row>[] = [
  { id: "name", header: "Name", widthPx: 160, type: "text" },
  { id: "qty", header: "Qty", widthPx: 100, type: "number" },
  // `enum` is what makes the Name funnel's sibling a CHECKLIST: an enum
  // column's first operator is `isAnyOf`, whose value shape is `set`, which
  // is the only shape that renders `site="filter-choice"` checkboxes. Without
  // it the fixture could not reach that site at all.
  {
    id: "status",
    header: "Status",
    widthPx: 120,
    type: "enum",
    options: [
      { value: "open", label: "Open" },
      { value: "closed", label: "Closed" },
    ],
  },
];

const FixtureButton: PretableButtonComponent = forwardRef(
  function FixtureButton({ site, variant, ...props }, ref) {
    return (
      <button
        {...props}
        ref={ref}
        type="button"
        data-fixture-button={site ?? ""}
        data-fixture-variant={variant ?? "ghost"}
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

/**
 * A picker replacement that is a plain button, not a combobox — deliberately
 * nothing like the kit's own. It records what the grid handed it (`site`, the
 * committed value, how many options) and, on click, commits the first other
 * enabled option, so a test can prove the grid's `onChange` reaches the model
 * through a replacement that shares none of the kit's internals.
 */
const FixtureSelect: PretableSelectComponent = forwardRef(
  function FixtureSelect(
    { site, options, value, onChange, "aria-label": label, ...props },
    ref,
  ) {
    return (
      <button
        {...props}
        ref={ref}
        type="button"
        aria-label={label}
        data-fixture-select={site ?? ""}
        data-fixture-value={value}
        data-fixture-option-count={options.length}
        onClick={() =>
          onChange(
            options.find((o) => o.value !== value && !o.disabled)?.value ??
              value,
          )
        }
      >
        {value}
      </button>
    );
  },
);

/**
 * A field replacement that is the native input and nothing else — the point
 * being that the grid's own value semantics (the debounce on the filter
 * operand, the search's live narrowing) live above the slot, so a bare input
 * is enough to drive them. It records its `site` and nothing else.
 */
const FixtureTextInput: PretableTextInputComponent = forwardRef(
  function FixtureTextInput({ site, ...props }, ref) {
    return <input {...props} ref={ref} data-fixture-field={site ?? ""} />;
  },
);

/**
 * A checkbox replacement that keeps the kit's CONTRACT and none of its
 * markup: no `role="checkbox"`, no `aria-checked`, just a button that records
 * the state it was handed and re-implements the one behaviour the kit
 * promises — consumer `onClick` first, `preventDefault()` vetoes the toggle.
 * A test that finds the grid still selecting rows through this proves the
 * grid drives the slot's props, not the kit's internals.
 */
const FixtureCheckbox: PretableCheckboxComponent = forwardRef(
  function FixtureCheckbox(
    { site, checked, onCheckedChange, onClick, ...props },
    ref,
  ) {
    return (
      <button
        {...props}
        ref={ref}
        type="button"
        data-fixture-checkbox={site ?? ""}
        data-fixture-checked={String(checked)}
        onClick={(event) => {
          onClick?.(event);
          if (event.defaultPrevented) return;
          onCheckedChange(checked !== true);
        }}
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
        components={{
          Button: FixtureButton,
          Checkbox: FixtureCheckbox,
          IconButton: FixtureIconButton,
          Select: FixtureSelect,
          TextInput: FixtureTextInput,
        }}
        getRowId={(row) => row.id}
        rowSelectionColumn={{ enabled: true, headerCheckbox: true }}
        rows={ROWS}
        toolPanel={{ defaultActiveSection: "columns" }}
        viewportHeight={240}
      />
    </main>
  );
}
