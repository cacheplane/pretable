/**
 * The grid's icon set. Thirteen glyphs on one 16px grid, 1.5px stroke, rounded
 * caps and joins, drawn in `currentColor` and sized from `--pretable-icon-size`.
 *
 * Deliberately not a dependency: the whole set is a few hundred bytes, and an
 * icon library would be a bundle, licensing and tree-shaking commitment for
 * thirteen shapes. Deliberately not Unicode text either — `▲`, `▾`, `✓` and `✕`
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
   sit inline between digits at ~0.85em, where the sort caret's 8x4 span reads
   as a wide, flat wedge rather than a direction. 6 wide by 4.5 tall, measured
   against a screenshot: the first pass at 7x4 rendered as a faint accent mark
   beside a 14px figure rather than as an arrow.

   Stroked, like the rest of the set. A filled triangle (which is what the
   reference designs use, and what `▲` would have given) carries more optical
   weight than the tabular digits beside it, so the marker would out-shout the
   number it qualifies. FunnelIcon already proves a 1.5px stroke closes cleanly
   at the Excel theme's 12px, which is the size these render at. */
export function DeltaUpIcon(props: IconProps) {
  return (
    <Glyph {...props}>
      <path d="M5 10.25 8 5.75 11 10.25" />
    </Glyph>
  );
}

export function DeltaDownIcon(props: IconProps) {
  return (
    <Glyph {...props}>
      <path d="M5 5.75 8 10.25 11 5.75" />
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

/* The tool rail's columns tab. Three vertical bars — a table read column-wise.
   Full-height strokes rather than a boxed table glyph: at 16px a 1.5px frame
   around three 1.5px dividers muddies, and the rail tab only has to say
   "columns", not "grid". */
export function ColumnsIcon(props: IconProps) {
  return (
    <Glyph {...props}>
      <path d="M4.25 3v10M8 3v10M11.75 3v10" />
    </Glyph>
  );
}

/* The tool rail's filters tab. Three stacked strokes narrowing downwards —
   a list being reduced. NOT the funnel: `FunnelIcon` is the header's
   per-column control, and the same glyph in the rail would promise the same
   menu. The taper does the same work with a different shape, and the widths
   (11 / 7 / 3 units) keep the bottom stroke long enough to read as a stroke
   rather than a dot at the Excel theme's 12px. */
export function FiltersIcon(props: IconProps) {
  return (
    <Glyph {...props}>
      <path d="M2.5 4h11M4.5 8h7M6.5 12h3" />
    </Glyph>
  );
}

/* The tool rail's grouping tab. A full-width bar with two indented bars
   beneath — rows folding under a parent. NOT the chevron the group rows
   themselves use: the tab names the FEATURE, not one group's open/closed
   state. The indent (3 units) does all the talking; widths step 11 / 8 / 8 so
   the children read as siblings of each other and subordinates of the top
   bar, and every stroke stays long enough to survive the Excel theme's 12px. */
export function GroupingIcon(props: IconProps) {
  return (
    <Glyph {...props}>
      <path d="M2.5 4h11M5.5 8h8M5.5 12h8" />
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
