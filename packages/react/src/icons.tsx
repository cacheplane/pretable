/**
 * The grid's icon set. Eleven glyphs on one 16px grid, 1.5px stroke, rounded
 * caps and joins, drawn in `currentColor` and sized from `--pretable-icon-size`.
 *
 * Deliberately not a dependency: the whole set is a few hundred bytes, and an
 * icon library would be a bundle, licensing and tree-shaking commitment for
 * nine shapes. Deliberately not Unicode text either — `▲`, `▾`, `✓` and `✕`
 * re-render in whatever font the active theme picked, so their weight, size and
 * baseline shifted between Excel's Aptos Narrow and Material's Roboto.
 *
 * Every glyph is `aria-hidden`: each sits inside a button that already carries
 * an `aria-label`, or beside an `aria-sort`. A title here would double-announce.
 *
 * Internal on purpose — not re-exported from `public_api.ts`.
 */
import type { SVGProps } from "react";

type IconProps = SVGProps<SVGSVGElement>;

function Glyph({ children, ...props }: IconProps) {
  return (
    <svg
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      // The hook `@pretable/ui` sizes every glyph through, from
      // `--pretable-icon-size`. It lives on the shared wrapper rather than at
      // each call site so a new glyph cannot be added unsized.
      data-pretable-icon=""
      {...props}
    >
      {children}
    </svg>
  );
}

export function ChevronDownIcon(props: IconProps) {
  return (
    <Glyph {...props}>
      <path d="M4 6.5 8 10.5 12 6.5" />
    </Glyph>
  );
}

export function SortAscIcon(props: IconProps) {
  return (
    <Glyph {...props}>
      <path d="M4 9.5 8 5.5 12 9.5" />
    </Glyph>
  );
}

export function SortDescIcon(props: IconProps) {
  return (
    <Glyph {...props}>
      <path d="M4 6.5 8 10.5 12 6.5" />
    </Glyph>
  );
}

/* The signed-delta direction markers. Deliberately NOT SortAsc/SortDescIcon
   reused: those are the header's sort affordance, and a reader who has learned
   that a caret in this grid means "sorted by this column" should not meet the
   identical shape inside a cell meaning something else. Narrower and more
   upright than the sort carets for the same reason they differ at all — these
   sit inline between digits at ~0.85em, where the sort caret's 8-unit span
   reads as a wide, flat wedge rather than a direction.

   Stroked, like the rest of the set. A filled triangle (which is what the
   reference designs use, and what `▲` would have given) carries more optical
   weight than the tabular digits beside it, so the marker would out-shout the
   number it qualifies. FunnelIcon already proves a 1.5px stroke closes cleanly
   at the Excel theme's 12px, which is the size these render at. */
export function DeltaUpIcon(props: IconProps) {
  return (
    <Glyph {...props}>
      <path d="M4.5 10 8 6 11.5 10" />
    </Glyph>
  );
}

export function DeltaDownIcon(props: IconProps) {
  return (
    <Glyph {...props}>
      <path d="M4.5 6 8 10 11.5 6" />
    </Glyph>
  );
}

export function CheckIcon(props: IconProps) {
  return (
    <Glyph {...props}>
      <path d="M3.5 8.5 6.5 11.5 12.5 4.5" />
    </Glyph>
  );
}

/* The indeterminate checkbox. Paired with CheckIcon on the same control, so it
   has to carry the same weight — an en-dash here re-rendered in the theme's
   font while the tick beside it did not. */
export function MinusIcon(props: IconProps) {
  return (
    <Glyph {...props}>
      <path d="M4 8h8" />
    </Glyph>
  );
}

export function CloseIcon(props: IconProps) {
  return (
    <Glyph {...props}>
      <path d="M4.5 4.5 11.5 11.5M11.5 4.5 4.5 11.5" />
    </Glyph>
  );
}

/* The stem is 3.5 units wide, not the 2.5 it reads best at on paper: two 1.5
   strokes facing each other across 2.5 units merge into a solid wedge, so the
   funnel came out heavier than the chevron and dots beside it. At 3.5 the stem
   stays an outline like the cone above it, and it still closes cleanly at the
   Excel theme's 12px rather than going hollow. */
export function FunnelIcon(props: IconProps) {
  return (
    <Glyph {...props}>
      <path d="M2.75 3.5h10.5L9.75 8.75v4L6.25 11.5V8.75z" />
    </Glyph>
  );
}

/* Dots, not strokes: a 1.5px-stroked 1px circle reads as mush at this size.
   The root keeps the shared stroke attributes so the set stays uniform; each
   circle opts out individually. */
export function OverflowIcon(props: IconProps) {
  return (
    <Glyph {...props}>
      <circle cx="8" cy="3.25" r="1.1" fill="currentColor" stroke="none" />
      <circle cx="8" cy="8" r="1.1" fill="currentColor" stroke="none" />
      <circle cx="8" cy="12.75" r="1.1" fill="currentColor" stroke="none" />
    </Glyph>
  );
}

export function GripIcon(props: IconProps) {
  return (
    <Glyph {...props}>
      {[5.5, 10.5].map((cx) =>
        [3.5, 8, 12.5].map((cy) => (
          <circle
            key={`${cx}-${cy}`}
            cx={cx}
            cy={cy}
            r="1"
            fill="currentColor"
            stroke="none"
          />
        )),
      )}
    </Glyph>
  );
}
