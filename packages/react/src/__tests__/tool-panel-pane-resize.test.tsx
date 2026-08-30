/**
 * The pane resize handle through the real surface (SP5, spec A1–A6): the
 * separator contract, the A5 no-inline-style-until-someone-acts rule, drag /
 * Escape / double-click / Enter, keyboard steps in both writing directions,
 * and the controlled trio's clamp-and-report.
 *
 * jsdom cannot lay out, so the pane measures 0 wide and the surface's max
 * bound stays unmeasured (`max: null`) throughout — every ceiling behavior
 * here exercises the floor and the unmeasured-max degradations; the real
 * ceiling is the pure module's table (tool-panel-pane-resize-math.test.ts)
 * plus the Playwright seam drag (Task 4). Widths asserted below are style
 * ATTRIBUTE text (`inline-size: Npx`): the inline style is the feature.
 */
import "@testing-library/jest-dom/vitest";
import { fireEvent, render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { PretableSurface } from "../public_api";
import type { PretableColumn, PretableToolPanelConfig } from "../public_api";
import { PANE_MIN_WIDTH_PX, PANE_KEY_STEP_PX } from "../tool-panel/pane-resize";

type Row = { id: string; name: string; amount: number };

const columns: PretableColumn<Row>[] = [
  { id: "name", header: "Name" },
  { id: "amount", header: "Amount" },
];
const rows: Row[] = [
  { id: "r1", name: "Alpha", amount: 1 },
  { id: "r2", name: "Beta", amount: 2 },
];

function renderSurface(toolPanel: PretableToolPanelConfig = {}, dir?: "rtl") {
  const surface = (
    <PretableSurface
      ariaLabel="Pane resize grid"
      columns={columns}
      rows={rows}
      getRowId={(r: Row) => r.id}
      toolPanel={{ defaultActiveSection: "columns", ...toolPanel }}
      viewportHeight={300}
    />
  );
  return render(dir === "rtl" ? <div dir="rtl">{surface}</div> : surface);
}

const handleOf = (container: HTMLElement) =>
  container.querySelector<HTMLElement>("[data-pretable-pane-resize]");
const paneOf = (container: HTMLElement) =>
  container.querySelector<HTMLElement>("[data-pretable-tool-pane]");
const paneWidth = (container: HTMLElement) => {
  const style = paneOf(container)?.getAttribute("style") ?? "";
  const m = /inline-size:\s*([0-9.]+)px/.exec(style);
  return m === null ? null : Number(m[1]);
};

describe("the resize handle's contract", () => {
  it("renders in the open pane as a focusable vertical separator", () => {
    const { container } = renderSurface();
    const handle = handleOf(container);
    expect(handle).not.toBeNull();
    expect(handle).toHaveAttribute("role", "separator");
    expect(handle).toHaveAttribute("aria-orientation", "vertical");
    expect(handle).toHaveAttribute("aria-label", "Resize tool panel");
    expect(handle?.tabIndex).toBe(0);
    expect(handle).toHaveAttribute("aria-valuemin", String(PANE_MIN_WIDTH_PX));
    // A focusable separator MUST carry aria-valuenow (ARIA 1.2 — omitted,
    // AT assumes now=50 of max=100, an inverted range against min=186). On
    // an unmeasured surface (jsdom) both now and max degrade to the floor
    // the first keystroke would step from — a collapsed but coherent range.
    expect(handle).toHaveAttribute("aria-valuenow", String(PANE_MIN_WIDTH_PX));
    expect(handle).toHaveAttribute("aria-valuemax", String(PANE_MIN_WIDTH_PX));
  });

  it("does not render while the pane is closed", () => {
    const { container } = renderSurface({ defaultActiveSection: null });
    expect(handleOf(container)).toBeNull();
  });

  it("reflects the committed width in aria-valuenow", () => {
    const { container } = renderSurface({ defaultPaneWidthPx: 300 });
    expect(handleOf(container)).toHaveAttribute("aria-valuenow", "300");
  });
});

describe("no inline style until someone acts (A5)", () => {
  it("writes no inline width untouched, and one after a keystroke", () => {
    const { container } = renderSurface();
    expect(paneWidth(container)).toBeNull();
    fireEvent.keyDown(handleOf(container)!, { key: "ArrowLeft" });
    // Untouched + unmeasurable pane: the gesture starts from the floor.
    expect(paneWidth(container)).toBe(PANE_MIN_WIDTH_PX + PANE_KEY_STEP_PX);
  });

  it("seeds an inline width from defaultPaneWidthPx", () => {
    const { container } = renderSurface({ defaultPaneWidthPx: 300 });
    expect(paneWidth(container)).toBe(300);
  });
});

describe("keyboard resize (A6)", () => {
  it("ltr: ArrowLeft grows, ArrowRight shrinks, Home floors", () => {
    const { container } = renderSurface({ defaultPaneWidthPx: 300 });
    const handle = handleOf(container)!;
    fireEvent.keyDown(handle, { key: "ArrowLeft" });
    expect(paneWidth(container)).toBe(300 + PANE_KEY_STEP_PX);
    fireEvent.keyDown(handle, { key: "ArrowRight" });
    fireEvent.keyDown(handle, { key: "ArrowRight" });
    expect(paneWidth(container)).toBe(300 - PANE_KEY_STEP_PX);
    fireEvent.keyDown(handle, { key: "Home" });
    expect(paneWidth(container)).toBe(PANE_MIN_WIDTH_PX);
  });

  it("rtl: the arrows flip with the writing direction", () => {
    const { container } = renderSurface({ defaultPaneWidthPx: 300 }, "rtl");
    const handle = handleOf(container)!;
    fireEvent.keyDown(handle, { key: "ArrowRight" });
    expect(paneWidth(container)).toBe(300 + PANE_KEY_STEP_PX);
    fireEvent.keyDown(handle, { key: "ArrowLeft" });
    fireEvent.keyDown(handle, { key: "ArrowLeft" });
    expect(paneWidth(container)).toBe(300 - PANE_KEY_STEP_PX);
  });

  it("a shrink step clamps at the floor", () => {
    const { container } = renderSurface({
      defaultPaneWidthPx: PANE_MIN_WIDTH_PX + 4,
    });
    fireEvent.keyDown(handleOf(container)!, { key: "ArrowRight" });
    expect(paneWidth(container)).toBe(PANE_MIN_WIDTH_PX);
  });

  it("End with an unmeasured max is a no-op", () => {
    const onPaneWidthChange = vi.fn();
    const { container } = renderSurface({
      defaultPaneWidthPx: 300,
      onPaneWidthChange,
    });
    fireEvent.keyDown(handleOf(container)!, { key: "End" });
    expect(paneWidth(container)).toBe(300);
    expect(onPaneWidthChange).not.toHaveBeenCalled();
  });

  it("Enter resets to the default width", () => {
    const { container } = renderSurface({ defaultPaneWidthPx: 300 });
    const handle = handleOf(container)!;
    fireEvent.keyDown(handle, { key: "ArrowLeft" });
    expect(paneWidth(container)).toBe(300 + PANE_KEY_STEP_PX);
    fireEvent.keyDown(handle, { key: "Enter" });
    expect(paneWidth(container)).toBe(300);
  });

  it("Enter with no default clears back to the stylesheet width", () => {
    const { container } = renderSurface();
    const handle = handleOf(container)!;
    fireEvent.keyDown(handle, { key: "ArrowLeft" });
    expect(paneWidth(container)).not.toBeNull();
    fireEvent.keyDown(handle, { key: "Enter" });
    expect(paneWidth(container)).toBeNull();
  });
});

describe("pointer drag (A2)", () => {
  const drag = (
    handle: HTMLElement,
    moves: readonly number[],
    startX = 500,
  ) => {
    fireEvent.pointerDown(handle, {
      button: 0,
      pointerId: 1,
      clientX: startX,
    });
    for (const clientX of moves) {
      fireEvent.pointerMove(handle, { pointerId: 1, clientX });
    }
  };

  it("applies the width live and keeps it on release", () => {
    const { container } = renderSurface({ defaultPaneWidthPx: 300 });
    const handle = handleOf(container)!;
    drag(handle, [440]);
    // ltr: 60px toward inline-start grows the pane.
    expect(paneWidth(container)).toBe(360);
    fireEvent.pointerUp(handle, { pointerId: 1, clientX: 440 });
    expect(paneWidth(container)).toBe(360);
  });

  it("rtl: the same pointer travel shrinks instead", () => {
    const { container } = renderSurface({ defaultPaneWidthPx: 300 }, "rtl");
    const handle = handleOf(container)!;
    drag(handle, [440]);
    expect(paneWidth(container)).toBe(240);
    fireEvent.pointerUp(handle, { pointerId: 1, clientX: 440 });
  });

  it("clamps a runaway shrink at the floor", () => {
    const { container } = renderSurface({ defaultPaneWidthPx: 300 });
    const handle = handleOf(container)!;
    drag(handle, [2000]);
    expect(paneWidth(container)).toBe(PANE_MIN_WIDTH_PX);
    fireEvent.pointerUp(handle, { pointerId: 1, clientX: 2000 });
  });

  it("Escape mid-drag restores the drag-start width", () => {
    const { container } = renderSurface({ defaultPaneWidthPx: 300 });
    const handle = handleOf(container)!;
    drag(handle, [440]);
    expect(paneWidth(container)).toBe(360);
    fireEvent.keyDown(handle, { key: "Escape" });
    expect(paneWidth(container)).toBe(300);
    // The cancelled gesture is over: further moves change nothing.
    fireEvent.pointerMove(handle, { pointerId: 1, clientX: 400 });
    expect(paneWidth(container)).toBe(300);
  });

  it("Escape reaches a drag even when focus sits elsewhere", () => {
    const { container } = renderSurface({ defaultPaneWidthPx: 300 });
    drag(handleOf(container)!, [440]);
    fireEvent.keyDown(document.body, { key: "Escape" });
    expect(paneWidth(container)).toBe(300);
  });

  it("a drag from the untouched state restores to NO inline width", () => {
    const { container } = renderSurface();
    const handle = handleOf(container)!;
    drag(handle, [400]);
    expect(paneWidth(container)).not.toBeNull();
    fireEvent.keyDown(handle, { key: "Escape" });
    expect(paneWidth(container)).toBeNull();
  });

  it("double-click resets to the default width", () => {
    const { container } = renderSurface({ defaultPaneWidthPx: 300 });
    const handle = handleOf(container)!;
    fireEvent.keyDown(handle, { key: "ArrowLeft" });
    fireEvent.dblClick(handle);
    expect(paneWidth(container)).toBe(300);
  });

  it("double-click with no default restores the stylesheet width", () => {
    const { container } = renderSurface();
    const handle = handleOf(container)!;
    fireEvent.keyDown(handle, { key: "ArrowLeft" });
    fireEvent.dblClick(handle);
    expect(paneWidth(container)).toBeNull();
  });

  it("the dblclick a real drag's release fires does not reset", () => {
    const { container } = renderSurface({ defaultPaneWidthPx: 300 });
    const handle = handleOf(container)!;
    drag(handle, [440]);
    fireEvent.pointerUp(handle, { pointerId: 1, clientX: 440 });
    fireEvent.dblClick(handle);
    expect(paneWidth(container)).toBe(360);
  });
});

describe("the controlled trio (A3, A4)", () => {
  it("asserts through paneWidthPx and only reports gestures", () => {
    const onPaneWidthChange = vi.fn();
    const { container } = renderSurface({
      paneWidthPx: 320,
      onPaneWidthChange,
    });
    expect(paneWidth(container)).toBe(320);
    const handle = handleOf(container)!;
    fireEvent.keyDown(handle, { key: "ArrowLeft" });
    // Reported, not applied — the parent did not accept the change.
    expect(onPaneWidthChange).toHaveBeenCalledWith(320 + PANE_KEY_STEP_PX);
    expect(paneWidth(container)).toBe(320);
  });

  it("paneWidthPx: null holds the stylesheet width under gestures", () => {
    const onPaneWidthChange = vi.fn();
    const { container } = renderSurface({
      paneWidthPx: null,
      onPaneWidthChange,
    });
    expect(paneWidth(container)).toBeNull();
    fireEvent.keyDown(handleOf(container)!, { key: "ArrowLeft" });
    expect(onPaneWidthChange).toHaveBeenCalledWith(
      PANE_MIN_WIDTH_PX + PANE_KEY_STEP_PX,
    );
    expect(paneWidth(container)).toBeNull();
  });

  it("an out-of-bounds controlled width renders clamped and reports the clamp", () => {
    const onPaneWidthChange = vi.fn();
    const { container } = renderSurface({
      paneWidthPx: 50,
      onPaneWidthChange,
    });
    expect(paneWidth(container)).toBe(PANE_MIN_WIDTH_PX);
    expect(handleOf(container)).toHaveAttribute(
      "aria-valuenow",
      String(PANE_MIN_WIDTH_PX),
    );
    expect(onPaneWidthChange).toHaveBeenCalledTimes(1);
    expect(onPaneWidthChange).toHaveBeenCalledWith(PANE_MIN_WIDTH_PX);
  });

  it("an out-of-bounds DEFAULT renders clamped and reports too", () => {
    const onPaneWidthChange = vi.fn();
    const { container } = renderSurface({
      defaultPaneWidthPx: 50,
      onPaneWidthChange,
    });
    expect(paneWidth(container)).toBe(PANE_MIN_WIDTH_PX);
    expect(onPaneWidthChange).toHaveBeenCalledWith(PANE_MIN_WIDTH_PX);
  });

  it("uncontrolled gestures report the committed width", () => {
    const onPaneWidthChange = vi.fn();
    const { container } = renderSurface({
      defaultPaneWidthPx: 300,
      onPaneWidthChange,
    });
    const handle = handleOf(container)!;
    fireEvent.keyDown(handle, { key: "ArrowLeft" });
    expect(onPaneWidthChange).toHaveBeenLastCalledWith(300 + PANE_KEY_STEP_PX);
    fireEvent.keyDown(handle, { key: "Enter" });
    expect(onPaneWidthChange).toHaveBeenLastCalledWith(300);
  });

  it("a reset with no default reports null", () => {
    const onPaneWidthChange = vi.fn();
    const { container } = renderSurface({ onPaneWidthChange });
    const handle = handleOf(container)!;
    fireEvent.keyDown(handle, { key: "ArrowLeft" });
    fireEvent.keyDown(handle, { key: "Enter" });
    expect(onPaneWidthChange).toHaveBeenLastCalledWith(null);
  });
});
