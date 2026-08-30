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
 * a direction marker, and the status and the badge have their labels. About 8%
 * of men cannot reliably separate the red from the green these use, and a
 * printed or greyscale grid has no hue at all — so a presentation that spoke
 * only in colour would simply not say anything to those readers.
 */
import {
  createElement,
  type HTMLAttributes,
  type ReactElement,
  type ReactNode,
} from "react";

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
}: PretableDeltaProps): ReactElement {
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
}: PretableStatusProps): ReactElement {
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

/**
 * The tones a {@link PretableBadge} can carry, drawn from the theme's semantic
 * ramp.
 *
 * There is no `neutral` member: a badge with no tone IS the neutral one, and it
 * is what the prop's absence already produces. A second spelling of the same
 * state would be a value the stylesheet has no rule for.
 *
 * @public
 */
export type PretableBadgeTone = "positive" | "negative" | "warning" | "info";

/**
 * Props for {@link PretableBadge}.
 *
 * @public
 */
export interface PretableBadgeProps extends Omit<
  HTMLAttributes<HTMLSpanElement>,
  "children"
> {
  /**
   * Which tone the label takes. Omit it for a plain chip in the cell's own ink.
   */
  tone?: PretableBadgeTone;
  /** The badge's label. A chip with nothing in it says nothing. */
  children?: ReactNode;
}

/**
 * A short label in a chip: a category, a flag, a state that is a noun rather
 * than a measurement.
 *
 * ```tsx
 * render: ({ row }) => (
 *   <PretableBadge tone={row.flag === "risk" ? "negative" : "warning"}>
 *     {row.flag}
 *   </PretableBadge>
 * )
 * ```
 *
 * The chip never tints its own fill, which is a contrast decision rather than a
 * stylistic one — see the rule in `@pretable/ui`'s `grid.css`. Tone rides on the
 * label's colour instead.
 *
 * A toned chip also draws a `currentColor` dot before its label, so tone stays
 * catchable without reading. That rule and this comment shipped together and
 * this comment did not mention it, which is how the docs page written from it
 * later told readers the label was the only tone channel — if the styling
 * changes again, change this sentence in the same commit.
 *
 * @public
 */
export function PretableBadge({
  tone,
  children,
  ...spanProps
}: PretableBadgeProps): ReactElement {
  return (
    // Both attributes follow the spread: they are this component's contract
    // with grid.css, not inputs. `data-pretable-tone` is left off entirely when
    // there is no tone — the base rule is the neutral badge.
    <span {...spanProps} data-pretable-badge="" data-pretable-tone={tone}>
      {children}
    </span>
  );
}

/**
 * Props for {@link PretableEntity}.
 *
 * @public
 */
export interface PretableEntityProps extends Omit<
  HTMLAttributes<HTMLSpanElement>,
  "children"
> {
  /** The identifying line — a ticker, an ID, a name. */
  primary: ReactNode;
  /**
   * The qualifying line beneath it. Omitted, the element is not rendered at
   * all: an empty one still claims a line box and would grow every row in the
   * column.
   */
  secondary?: ReactNode;
}

/**
 * An identity: a primary line with a quieter one beneath it, the shape almost
 * every grid's first column takes.
 *
 * ```tsx
 * render: ({ row }) => (
 *   <PretableEntity primary={row.symbol} secondary={row.name} />
 * )
 * ```
 *
 * The secondary line is subordinated by a token and a type size, never by an
 * opacity — a translucent secondary cannot reach 4.5:1 and still read as
 * secondary, which is how every hand-rolled version of this pattern has failed.
 *
 * @public
 */
export function PretableEntity({
  primary,
  secondary,
  ...spanProps
}: PretableEntityProps): ReactElement {
  return (
    <span {...spanProps} data-pretable-entity="">
      <span data-pretable-entity-primary="">{primary}</span>
      {/* An explicit null check, not `secondary && …`: 0 and "" are values a
          secondary line legitimately holds — a count, a code — and a falsy
          guard would silently drop them. */}
      {secondary === undefined || secondary === null ? null : (
        <span data-pretable-entity-secondary="">{secondary}</span>
      )}
    </span>
  );
}
