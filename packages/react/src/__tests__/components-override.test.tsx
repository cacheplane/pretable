// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { forwardRef } from "react";
import { afterEach, describe, expect, it } from "vitest";

import { Pretable } from "../pretable";
import { PretableSurface } from "../pretable-surface";
import type { PretableColumn } from "../types";
import type {
  PretableButtonComponent,
  PretableComponents,
  PretableIconButtonComponent,
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
    expect(dialog.parentElement).toBe(document.body);
    const clear = dialog.querySelector("[data-pretable-filter-clear]")!;
    expect(clear).toHaveAttribute("data-mine", "filter-clear");
  });

  it("a fresh object literal with the same components does not remount the buttons", () => {
    // Inline `components={{ Button: MyButton }}` is the common way to write
    // it, and it produces a new object every render. The resolved map is
    // memoised on the slot VALUES, so the node survives a re-render.
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
    fireEvent.pointerDown(kebab);
    fireEvent.click(kebab);
    expect(
      document.querySelector("[data-pretable-column-menu]"),
    ).not.toBeNull();
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
