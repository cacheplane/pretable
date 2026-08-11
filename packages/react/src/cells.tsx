/**
 * Cell presentations — small, composable readings of a value, styled by
 * `@pretable/ui`'s `grid.css` and emitted from a column's `render`.
 *
 * These are opt-in, never automatic: the grid does not infer that a number is a
 * change rather than a quantity, or that a string is a state rather than a
 * label. Only the consumer knows that, so only the consumer asks for it.
 *
 * Every one of them is purely presentational — no state, no effects, no
 * measurement. They render inside a virtualized body where the visible rows
 * re-render on every scroll frame and on every streamed update, so anything
 * that hooked, measured or memoized here would do it thousands of times a
 * second for no gain.
 *
 * Each also carries its meaning on a channel that is NOT colour: the delta has
 * a direction marker, the status has its label. About 8% of men cannot reliably
 * separate the red from the green these use, and a printed or greyscale grid
 * has no hue at all — so a presentation that spoke only in colour would simply
 * not say anything to those readers.
 */
import type { HTMLAttributes, ReactNode } from "react";

import { warnOnce } from "./dev-warn";
import { DeltaDownIcon, DeltaUpIcon, MinusIcon } from "./icons";

/**
 * Which way a {@link PretableDelta} moved, derived from the sign of its value.
 *
 * @public
 */
export type PretableDeltaDirection = "up" | "down" | "flat";

/**
 * Props for {@link PretableDelta}.
 *
 * @public
 */
export interface PretableDeltaProps extends Omit<
  HTMLAttributes<HTMLSpanElement>,
  "children"
> {
  /**
   * The signed number the direction is read from. It is **not** rendered —
   * pass the display text as `children`.
   */
  value: number;
  /**
   * The already-formatted text to display. Formatting is locale- and
   * currency-dependent, so it stays the caller's decision; this component never
   * calls `toLocaleString` or `toFixed` on `value` and never invents a string.
   */
  children?: ReactNode;
}

/**
 * A signed numeric change: the caller's formatted text, tinted by direction and
 * prefixed with a direction marker.
 *
 * ```tsx
 * render: ({ row }) => (
 *   <PretableDelta value={row.dayPnl}>{fmtSignedUsd(row.dayPnl)}</PretableDelta>
 * )
 * ```
 *
 * @public
 */
export function PretableDelta({
  value,
  children,
  ...spanProps
}: PretableDeltaProps) {
  // Not `value >= 0 ? up : down`. Zero is not a rise, and neither is -0 (what
  // `Math.round(-0.2)` yields) or NaN (which compares false against everything)
  // — painting any of them as a movement asserts something the data does not
  // contain. Both comparisons must be explicit for the third case to exist.
  const direction: PretableDeltaDirection =
    value > 0 ? "up" : value < 0 ? "down" : "flat";

  // MinusIcon for flat, rather than a third delta glyph: it exists precisely to
  // avoid an en-dash re-rendering in the theme's font, which is the same reason
  // the two carets are elements instead of `▲`/`▼`.
  const Marker =
    direction === "up"
      ? DeltaUpIcon
      : direction === "down"
        ? DeltaDownIcon
        : MinusIcon;

  return (
    // `data-pretable-delta` follows the spread deliberately: the attribute is
    // this component's contract with grid.css, not an input a caller can set to
    // something the value disagrees with.
    <span {...spanProps} data-pretable-delta={direction}>
      <Marker />
      {children}
    </span>
  );
}

/**
 * The states a {@link PretableStatus} can report.
 *
 * @public
 */
export type PretableStatusTone =
  "positive" | "negative" | "warning" | "info" | "neutral";

/**
 * Props for {@link PretableStatus}.
 *
 * @public
 */
export interface PretableStatusProps extends Omit<
  HTMLAttributes<HTMLSpanElement>,
  "children"
> {
  /** Which state the row is in. `neutral` draws a dimmed dot. */
  tone: PretableStatusTone;
  /**
   * The state's label. Required in practice: the dot is drawn with
   * `content: ""`, so the label is the only part of a status any reader who is
   * not separating hues — or any screen reader at all — can perceive.
   */
  children?: ReactNode;
}

/**
 * A state: a coloured dot followed by its label.
 *
 * ```tsx
 * render: ({ row }) => (
 *   <PretableStatus tone={row.settled ? "positive" : "warning"}>
 *     {row.settlementState}
 *   </PretableStatus>
 * )
 * ```
 *
 * @public
 */
export function PretableStatus({
  tone,
  children,
  ...spanProps
}: PretableStatusProps) {
  if (children === undefined || children === null || children === "") {
    warnOnce(
      "status-without-label",
      "[pretable] <PretableStatus> rendered without a label. The dot is drawn " +
        'with `content: ""`, so a status with no children conveys its state ' +
        "by colour alone: invisible in greyscale, unreadable to a colour-blind " +
        "reader, and silent to a screen reader. Pass the state's name as children.",
    );
  }

  return (
    <span {...spanProps} data-pretable-status={tone}>
      {children}
    </span>
  );
}
