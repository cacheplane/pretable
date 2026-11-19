import { planViewport } from "./viewport-plan";
import type { PlanViewportInput, PlannedRow, ViewportPlan } from "./types";

/** A pure, revision-bound read. Callers supply metrics and values from one accepted projection. */
export interface ReadLayoutInput<T> extends PlanViewportInput {
  /** Preserves indexed local range reads; sparse adapters materialize only this viewport. */
  readonly readRange: (start: number, end: number) => readonly T[];
}
export interface ReadLayoutResult<T> extends Omit<ViewportPlan, "rows"> {
  readonly scrollTop: number;
  readonly values: readonly T[];
  readonly rows: readonly (PlannedRow & { readonly value: T })[];
}
/** Coordinates, including manual spacers, remain global throughout publication. */
export function readLayout<T>(input: ReadLayoutInput<T>): ReadLayoutResult<T> {
  const total =
    Math.max(0, input.leadingHeight ?? 0) +
    input.rowMetrics.getTotalHeight() +
    Math.max(0, input.trailingHeight ?? 0);
  const scrollTop = Math.max(
    0,
    Math.min(
      input.scrollTop,
      Math.max(0, total - Math.max(0, input.viewportHeight)),
    ),
  );
  const plan = planViewport({ ...input, scrollTop });
  const values = input.readRange(plan.range.start, plan.range.end);
  if (values.length !== plan.range.end - plan.range.start)
    throw new RangeError("Layout range does not match its geometry");
  return Object.freeze({
    ...plan,
    range: Object.freeze(plan.range),
    scrollTop,
    values: Object.freeze([...values]),
    rows: Object.freeze(
      plan.rows.map((row, offset) =>
        Object.freeze({ ...row, value: values[offset]! }),
      ),
    ),
  });
}
