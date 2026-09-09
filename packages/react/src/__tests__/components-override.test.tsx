// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { forwardRef, useState } from "react";
import { afterEach, describe, expect, it } from "vitest";

import { Pretable } from "../pretable";
import { PretableSurface } from "../pretable-surface";
import type { PretableColumn } from "../types";
import { chooseOption } from "./select-helpers";
import type {
  PretableButtonComponent,
  PretableCheckboxComponent,
  PretableComponents,
  PretableIconButtonComponent,
  PretableSelectComponent,
  PretableTextInputComponent,
} from "../components/context";

afterEach(() => {
  cleanup();
});

type Row = { id: string; name: string; qty: number };
const columns: PretableColumn<Row>[] = [
  { id: "name", header: "Name", widthPx: 160, type: "text" },
  { id: "qty", header: "Qty", widthPx: 100, type: "number" },
];
const rows: Row[] = [
  { id: "a", name: "Alpha", qty: 1 },
  { id: "b", name: "Bravo", qty: 2 },
];

/** A replacement that marks itself and records what site it was asked for. */
const MyButton: PretableButtonComponent = forwardRef(function MyButton(
  { site, variant, ...props },
  ref,
) {
  return (
    <button
      {...props}
      ref={ref}
      type="button"
      data-mine={site ?? ""}
      data-mine-variant={variant}
    />
  );
});
const MyIconButton: PretableIconButtonComponent = forwardRef(
  function MyIconButton({ site, ...props }, ref) {
    return (
      <button {...props} ref={ref} type="button" data-mine-icon={site ?? ""} />
    );
  },
);

/**
 * A replacement picker. `options`, `value`, `onChange` and `site` are the
 * kit's own props and mean nothing to a <button>, so they are destructured
 * AWAY before the spread — left in, React warns about every one of them on
 * every render and the suite's console fills with noise that hides real
 * warnings.
 */
const MySelect: PretableSelectComponent = forwardRef(function MySelect(
  { options, value, onChange, site, ...props },
  ref,
) {
  return (
    <button
      {...props}
      ref={ref}
      type="button"
      data-mine-select={site ?? ""}
      data-mine-value={value}
      data-mine-option-count={options.length}
      onClick={() => onChange(options[0]?.value ?? "")}
    />
  );
});

/**
 * A replacement field. The kit's `site` means nothing to a bare <input>, so
 * it is destructured away before the spread — left in, React warns on every
 * render. Everything else IS an input attribute and passes straight through,
 * which is the point: the kit's text input is the native element.
 */
const MyTextInput: PretableTextInputComponent = forwardRef(function MyTextInput(
  { site, ...props },
  ref,
) {
  return <input {...props} ref={ref} data-mine-field={site ?? ""} />;
});

/**
 * A replacement checkbox. `checked` and `onCheckedChange` are the kit's own
 * controlled pair and mean nothing to a <button>, so both are destructured
 * away — and re-expressed here as `aria-checked` plus a click that reports
 * the next value, which is what a replacement genuinely has to do.
 */
const MyCheckbox: PretableCheckboxComponent = forwardRef(function MyCheckbox(
  { checked, onCheckedChange, site, onClick, ...props },
  ref,
) {
  return (
    <button
      {...props}
      ref={ref}
      type="button"
      role="checkbox"
      aria-checked={checked}
      data-mine-check={site ?? ""}
      data-mine-checked={String(checked)}
      onClick={(event) => {
        onClick?.(event);
        if (event.defaultPrevented) return;
        onCheckedChange(checked !== true);
      }}
    />
  );
});

// `PretableSurface` is generic, so `ComponentProps<typeof PretableSurface>`
// resolves its props against `{}`; the prop's own type is the direct thing to
// name here anyway.
function renderSurface(components?: PretableComponents) {
  return render(
    <PretableSurface<Row>
      ariaLabel="override-grid"
      columns={columns}
      components={components}
      getRowId={(row) => row.id}
      rows={rows}
      toolPanel={{ defaultActiveSection: "columns" }}
      viewportHeight={240}
    />,
  );
}

describe("components on the surface", () => {
  it("without the prop, the grid draws the kit's own buttons", () => {
    const view = renderSurface();
    const reset = view.getByRole("button", { name: "Reset columns" });
    expect(reset).toHaveAttribute("data-pretable-button", "");
    expect(reset).toHaveAttribute("data-pretable-site", "tool-reset");
    expect(reset).toHaveAttribute("data-pretable-tool-reset", "");
  });

  it("replaces every Button, passing the site through, and keeps the site's own attribute", () => {
    const view = renderSurface({ Button: MyButton });
    const reset = view.getByRole("button", { name: "Reset columns" });
    expect(reset).toHaveAttribute("data-mine", "tool-reset");
    expect(reset).toHaveAttribute("data-mine-variant", "link");
    // Nothing that identified this button before stops identifying it.
    expect(reset).toHaveAttribute("data-pretable-tool-reset", "");
    expect(reset).not.toHaveAttribute("data-pretable-button");
    // The other slot is untouched.
    expect(
      view.container.querySelector("[data-pretable-icon-button]"),
    ).not.toBeNull();
  });

  it("replaces every IconButton, including one in the header", () => {
    const view = renderSurface({ IconButton: MyIconButton });
    const funnel = view.getByRole("button", { name: "Filter Name" });
    expect(funnel).toHaveAttribute("data-mine-icon", "filter-funnel");
    expect(funnel).toHaveAttribute("data-pretable-filter-funnel", "");
    expect(funnel).toHaveAttribute("tabindex", "-1");
  });

  it("reaches a button inside a PORTALLED popover — the reason this is context, not props", async () => {
    const view = renderSurface({ Button: MyButton });
    const funnel = view.getByRole("button", { name: "Filter Name" });
    fireEvent.pointerDown(funnel);
    fireEvent.click(funnel);
    // The filter dialog renders through OverlayPortal into document.body.
    const dialog = await waitFor(() => {
      const el = document.querySelector("[data-pretable-filter-menu]");
      if (!el) throw new Error("dialog not open");
      return el;
    });
    expect(dialog.closest("[data-pretable-overlay-root]")?.parentElement).toBe(
      document.body,
    );
    const clear = dialog.querySelector("[data-pretable-filter-clear]")!;
    expect(clear).toHaveAttribute("data-mine", "filter-clear");
  });

  it("a fresh object literal with the same components does not remount the buttons", () => {
    // Inline `components={{ Button: MyButton }}` produces a new object every
    // render; this pins that a re-render with it does not REMOUNT the button
    // node. It does not pin the memo — a same-type element reconciles to the
    // same node whether or not the context value changed identity — so the
    // memoisation itself is proven at the hook level, in
    // components-button.test.tsx ("a stable input is a stable output" and
    // "a changed slot yields a new map").
    const view = renderSurface({ Button: MyButton });
    const before = view.getByRole("button", { name: "Reset columns" });
    view.rerender(
      <PretableSurface<Row>
        ariaLabel="override-grid"
        columns={columns}
        components={{ Button: MyButton }}
        getRowId={(row) => row.id}
        rows={rows}
        toolPanel={{ defaultActiveSection: "columns" }}
        viewportHeight={240}
      />,
    );
    expect(view.getByRole("button", { name: "Reset columns" })).toBe(before);
  });

  it("the replacement still receives the ref the grid anchors on", () => {
    // The kebab menu anchors on its button's node through a ref callback. A
    // replacement that forwards its ref keeps that working.
    const view = renderSurface({ IconButton: MyIconButton });
    const kebab = view.container.querySelector(
      "[data-pretable-tool-row-menu-button]",
    )!;
    // Prove the node IS the replacement before asking anything of it —
    // otherwise the menu opening proves nothing about the forwarded ref.
    expect(kebab).toHaveAttribute("data-mine-icon", "tool-row-menu-button");
    fireEvent.pointerDown(kebab);
    fireEvent.click(kebab);
    expect(
      document.querySelector("[data-pretable-column-menu]"),
    ).not.toBeNull();
  });

  it("every migrated site renders the kit component, carrying its site name", () => {
    // The CSS guards in @pretable/ui assume each site's element carries the
    // kit attribute — a site that quietly went back to a raw <button> would
    // leave those guards green while losing its whole box. This is the
    // bridge that makes them load-bearing. Rows are grouped so the grouping
    // section, its chips and its removes all render.
    const view = render(
      <PretableSurface<Row>
        ariaLabel="sites-grid"
        columns={columns}
        getRowId={(row) => row.id}
        rows={rows}
        groupPanel={{ enabled: true }}
        toolPanel={{ defaultActiveSection: "grouping" }}
        viewportHeight={240}
        query={{ filters: [], sort: [], rowGroups: [{ columnId: "name" }] }}
        onQueryChange={() => {}}
      />,
    );
    const expectKit = (
      attr: string,
      kind: "button" | "icon-button" | "select" | "text-input" | "checkbox",
      site: string,
    ) => {
      const el =
        view.container.querySelector(`[data-pretable-${attr}]`) ??
        document.querySelector(`[data-pretable-${attr}]`);
      expect(el, `no element carries data-pretable-${attr}`).not.toBeNull();
      expect(el).toHaveAttribute(`data-pretable-${kind}`, "");
      expect(el).toHaveAttribute("data-pretable-site", site);
    };
    // Grouping section (open): add-group, expand-all, collapse-all, tool-group-remove.
    expectKit("add-group", "button", "add-group");
    expectKit("expand-all", "button", "expand-all");
    expectKit("collapse-all", "button", "collapse-all");
    expectKit("tool-group-remove", "icon-button", "tool-group-remove");
    // Header: funnel and column menu.
    expectKit("filter-funnel", "icon-button", "filter-funnel");
    expectKit("column-menu-button", "icon-button", "column-menu-button");
    // Group panel chip remove (a grouped column renders a chip).
    expectKit("chip-remove", "icon-button", "chip-remove");
    // The grouping section's aggregate picker — the kit Select, not a native
    // <select>, and the only one of the four sites this fixture renders.
    expectKit("aggregate", "select", "aggregate");
  });

  it("the columns and filters sections' sites render the kit component too", async () => {
    const view = renderSurface(); // columns section open
    const kit = (
      attr: string,
      kind: "button" | "icon-button" | "select" | "text-input" | "checkbox",
      site: string,
    ) => {
      const el = view.container.querySelector(`[data-pretable-${attr}]`);
      expect(el, `no element carries data-pretable-${attr}`).not.toBeNull();
      expect(el).toHaveAttribute(`data-pretable-${kind}`, "");
      expect(el).toHaveAttribute("data-pretable-site", site);
    };
    kit("tool-reset", "button", "tool-reset");
    kit("tool-row-menu-button", "icon-button", "tool-row-menu-button");
    // Filters section: + filter, then the row it adds carries its remove.
    fireEvent.click(view.getByRole("tab", { name: /filter/i }));
    kit("filter-add", "button", "filter-add");
    fireEvent.click(
      view.container.querySelector("[data-pretable-filter-add]")!,
    );
    kit("filter-row-remove", "icon-button", "filter-row-remove");
    // The leaf row's two pickers are kit Selects.
    kit("filter-row-column", "select", "filter-row-column");
    kit("filter-row-operator", "select", "filter-row-operator");
    // The dialog's Clear is portalled: open a funnel.
    const funnel = view.container.querySelector(
      "[data-pretable-filter-funnel]",
    )!;
    fireEvent.pointerDown(funnel);
    fireEvent.click(funnel);
    const dialog = await waitFor(() => {
      const el = document.querySelector("[data-pretable-filter-menu]");
      if (!el) throw new Error("dialog not open");
      return el;
    });
    const clear = dialog.querySelector("[data-pretable-filter-clear]");
    expect(clear).not.toBeNull();
    expect(clear).toHaveAttribute("data-pretable-button", "");
    expect(clear).toHaveAttribute("data-pretable-site", "filter-clear");
    // And the dialog's operator picker, the fourth select site.
    const operator = dialog.querySelector("[data-pretable-filter-operator]");
    expect(operator).not.toBeNull();
    expect(operator).toHaveAttribute("data-pretable-select", "");
    expect(operator).toHaveAttribute("data-pretable-site", "filter-operator");
  });

  it("replaces every Select — the portalled dialog's picker and the builder's", async () => {
    const view = renderSurface({ Select: MySelect });

    // The builder's column picker, inside the pane.
    fireEvent.click(view.getByRole("tab", { name: /filter/i }));
    fireEvent.click(
      view.container.querySelector("[data-pretable-filter-add]")!,
    );
    const column = view.container.querySelector(
      "[data-pretable-filter-row-column]",
    )!;
    expect(column).toHaveAttribute("data-mine-select", "filter-row-column");
    expect(column).toHaveAttribute("data-mine-value", "name");
    // The override receives every filterable column in the fixture, not a
    // truncated or empty list — a site that handed it nothing would still
    // pass the checks above.
    expect(column).toHaveAttribute(
      "data-mine-option-count",
      String(columns.length),
    );
    // Nothing that identified this picker before stops identifying it, and
    // the kit's own attribute is gone with the kit component.
    expect(column).not.toHaveAttribute("data-pretable-select");

    // And the dialog's operator picker, which renders through OverlayPortal
    // into document.body — the reason this is context and not props.
    const funnel = view.container.querySelector(
      "[data-pretable-filter-funnel]",
    )!;
    fireEvent.pointerDown(funnel);
    fireEvent.click(funnel);
    const dialog = await waitFor(() => {
      const el = document.querySelector("[data-pretable-filter-menu]");
      if (!el) throw new Error("dialog not open");
      return el;
    });
    const operator = dialog.querySelector("[data-pretable-filter-operator]")!;
    expect(operator).toHaveAttribute("data-mine-select", "filter-operator");
    expect(operator).not.toHaveAttribute("data-pretable-select");
    // The dialog focuses the picker on open through the ref it holds, so a
    // replacement that forwards its ref keeps that working.
    expect(operator).toHaveFocus();
  });
});

describe("the fields and checkboxes on the surface", () => {
  /** Wide enough to reach every one of the ten SP3 sites: an ENUM column
   *  gives both checklists their choices, a BOOLEAN column gives the boolean
   *  cell, and `rowSelectionColumn` gives the two selection checkboxes. */
  type Rich = {
    id: string;
    name: string;
    sev: string;
    done: boolean;
    qty: number;
  };
  const richColumns: PretableColumn<Rich>[] = [
    { id: "name", header: "Name", widthPx: 160, type: "text" },
    // A NUMBER column, for the range twins alone: `filter-min` and
    // `filter-max` render only under a range-shaped operator, which no other
    // column here can reach.
    { id: "qty", header: "Qty", widthPx: 100, type: "number" },
    {
      id: "sev",
      header: "Sev",
      widthPx: 120,
      type: "enum",
      options: [{ value: "high" }, { value: "low" }],
    },
    {
      id: "done",
      header: "Done",
      widthPx: 100,
      type: "boolean",
      editable: true,
    },
  ];
  const richRows: Rich[] = [
    { id: "a", name: "Alpha", sev: "high", done: true, qty: 1 },
    { id: "b", name: "Bravo", sev: "low", done: false, qty: 2 },
  ];

  /** The filters pane open on a set-shaped leaf over the enum column, so the
   *  builder draws its checklist without a click; the funnel is opened per
   *  test for the dialog's.
   *
   *  CONTROLLED, with the query echoed back through state: a no-op
   *  `onQueryChange` would pin the tree at its seed, so `+ filter` would add
   *  a row that never renders and the single-value field would be
   *  unreachable. */
  function Rich({ components }: { components?: PretableComponents }) {
    // `as never` on both sides, the harness cast this suite's neighbours
    // already use: the surface's query type is resolved against its column
    // generic, and restating it here would be a second declaration to keep.
    const [query, setQuery] = useState({
      filters: [{ columnId: "sev", operator: "isAnyOf", value: ["high"] }],
      sort: [],
      rowGroups: [],
    });
    return (
      <PretableSurface<Rich>
        ariaLabel="fields-grid"
        columns={richColumns}
        components={components}
        getRowId={(row) => row.id}
        rows={richRows}
        rowSelectionColumn={{ enabled: true }}
        onQueryChange={(next) => setQuery(next as never)}
        query={query as never}
        toolPanel={{ defaultActiveSection: "filters" }}
        viewportHeight={240}
      />
    );
  }

  function renderRich(components?: PretableComponents) {
    return render(<Rich components={components} />);
  }

  /** Open a column's funnel and hand back the portalled dialog, identified by
   *  a marker the dialog's own body carries — `[data-pretable-filter-menu]`
   *  alone would match whichever dialog is open, including one left over. */
  async function openFunnel(
    view: ReturnType<typeof renderRich>,
    header: string,
    marker: string,
  ) {
    const funnel = view.getByRole("button", { name: `Filter ${header}` });
    fireEvent.pointerDown(funnel);
    fireEvent.click(funnel);
    return await waitFor(() => {
      const el = document.querySelector(
        `[data-pretable-filter-menu]:has([data-pretable-${marker}])`,
      );
      if (!el) throw new Error(`${header} dialog not open`);
      return el;
    });
  }

  /** The number column's dialog with the range twins drawn: its operator
   *  picker starts single-shaped, so `between` has to be chosen first. */
  async function openRangeDialog(view: ReturnType<typeof renderRich>) {
    const funnel = view.getByRole("button", { name: "Filter Qty" });
    fireEvent.pointerDown(funnel);
    fireEvent.click(funnel);
    // By aria-label, not by a part every dialog has: a stale dialog from an
    // earlier step would satisfy `:has([data-pretable-filter-operator])` and
    // this would then drive the WRONG column's picker.
    const dialog = await waitFor(() => {
      const el = document.querySelector<HTMLElement>(
        '[data-pretable-filter-menu][aria-label="Filter Qty"]',
      );
      if (!el) throw new Error("Qty dialog not open");
      return el;
    });
    chooseOption(
      dialog.querySelector<HTMLElement>("[data-pretable-filter-operator]")!,
      "between",
    );
    return await waitFor(() => {
      const el = document.querySelector(
        "[data-pretable-filter-menu]:has([data-pretable-filter-min])",
      );
      if (!el) throw new Error("range twins not drawn");
      return el;
    });
  }

  it("every field and checkbox site renders the kit component, carrying its site name", async () => {
    // The same bridge the button and picker sites have: the @pretable/ui CSS
    // guards assume each site's element wears the kit attribute, and a site
    // that quietly went back to a raw <input> or <button> would leave every
    // one of them green while losing its whole box.
    const view = renderRich();
    const kit = (
      attr: string,
      kind: "text-input" | "checkbox",
      site: string,
      scope: ParentNode = view.container,
    ) => {
      const el = scope.querySelector(`[data-pretable-${attr}]`);
      expect(el, `no element carries data-pretable-${attr}`).not.toBeNull();
      expect(el).toHaveAttribute(`data-pretable-${kind}`, "");
      expect(el).toHaveAttribute("data-pretable-site", site);
    };

    // The two selection checkboxes and the boolean cell, in the grid itself.
    kit("row-select-all", "checkbox", "row-select-all");
    kit("row-select", "checkbox", "row-select");
    kit("bool-cell", "checkbox", "bool-cell");
    // The builder's set-shaped leaf: its checklist choices.
    kit("filter-row-choice", "checkbox", "filter-row-choice");
    // The builder's value FIELD needs a single-value leaf; the mounted one is
    // set-shaped, so switch the column to the text one.
    fireEvent.click(
      view.container.querySelector("[data-pretable-filter-add]")!,
    );
    kit("filter-row-value", "text-input", "filter-row-value");
    // The columns pane: the search box and the visibility toggle.
    fireEvent.click(view.getByRole("tab", { name: /column/i }));
    kit("tool-search", "text-input", "tool-search");
    kit("tool-column-toggle", "checkbox", "tool-column-toggle");
    // The grouping pane: the hide-grouped switch.
    fireEvent.click(view.getByRole("tab", { name: /group/i }));
    kit("hide-grouped", "checkbox", "hide-grouped");
    // And the portalled dialog's two: the value field on a text column, the
    // checklist choices on the enum one.
    const dialog = await openFunnel(view, "Sev", "filter-choice");
    kit("filter-choice", "checkbox", "filter-choice", dialog);
    const textDialog = await openFunnel(view, "Name", "filter-value");
    kit("filter-value", "text-input", "filter-value", textDialog);
    // And the range twins, which are the same `filter-value` site twice over
    // — the site name is what the theme keys on, so both wear it.
    const rangeDialog = await openRangeDialog(view);
    kit("filter-min", "text-input", "filter-value", rangeDialog);
    kit("filter-max", "text-input", "filter-value", rangeDialog);
  });

  it("replaces every TextInput and Checkbox, the portalled dialog's included", async () => {
    const view = renderRich({
      TextInput: MyTextInput,
      Checkbox: MyCheckbox,
    });
    const mine = (
      attr: string,
      marker: "data-mine-field" | "data-mine-check",
      site: string,
      scope: ParentNode = view.container,
    ) => {
      const el = scope.querySelector(`[data-pretable-${attr}]`);
      expect(el, `no element carries data-pretable-${attr}`).not.toBeNull();
      expect(el).toHaveAttribute(marker, site);
      // Nothing that identified the control before stops identifying it, and
      // the kit's own attribute goes with the kit component.
      expect(el).not.toHaveAttribute("data-pretable-text-input");
      expect(el).not.toHaveAttribute("data-pretable-checkbox");
    };

    mine("row-select-all", "data-mine-check", "row-select-all");
    mine("row-select", "data-mine-check", "row-select");
    mine("bool-cell", "data-mine-check", "bool-cell");
    mine("filter-row-choice", "data-mine-check", "filter-row-choice");
    fireEvent.click(
      view.container.querySelector("[data-pretable-filter-add]")!,
    );
    mine("filter-row-value", "data-mine-field", "filter-row-value");
    fireEvent.click(view.getByRole("tab", { name: /column/i }));
    mine("tool-search", "data-mine-field", "tool-search");
    mine("tool-column-toggle", "data-mine-check", "tool-column-toggle");
    fireEvent.click(view.getByRole("tab", { name: /group/i }));
    mine("hide-grouped", "data-mine-check", "hide-grouped");
    const dialog = await openFunnel(view, "Sev", "filter-choice");
    mine("filter-choice", "data-mine-check", "filter-choice", dialog);
    const textDialog = await openFunnel(view, "Name", "filter-value");
    mine("filter-value", "data-mine-field", "filter-value", textDialog);
    const rangeDialog = await openRangeDialog(view);
    mine("filter-min", "data-mine-field", "filter-value", rangeDialog);
    mine("filter-max", "data-mine-field", "filter-value", rangeDialog);

    // And the kit is GONE from the whole tree, portal included: a site left
    // behind would satisfy every per-site check above.
    expect(document.querySelector("[data-pretable-text-input]")).toBeNull();
    expect(document.querySelector("[data-pretable-checkbox]")).toBeNull();
  });
});

describe("components on the <Pretable> preset", () => {
  it("forwards the prop", () => {
    const view = render(
      <Pretable<Row>
        ariaLabel="preset-grid"
        columns={columns}
        components={{ Button: MyButton }}
        rows={rows}
      />,
    );
    // The preset ships the tool panel on by default; open the columns tab.
    const tab = view.container.querySelector("[data-pretable-tool-tab]")!;
    fireEvent.click(tab);
    expect(view.getByRole("button", { name: "Reset columns" })).toHaveAttribute(
      "data-mine",
      "tool-reset",
    );
  });
});
