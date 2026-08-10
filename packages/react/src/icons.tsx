/**
 * The grid's icon set. Eight glyphs on one 16px grid, 1.5px stroke, rounded
 * caps and joins, drawn in `currentColor` and sized from `--pretable-icon-size`.
 *
 * Deliberately not a dependency: the whole set is a few hundred bytes, and an
 * icon library would be a bundle, licensing and tree-shaking commitment for
 * eight shapes. Deliberately not Unicode text either — `▲`, `▾`, `✓` and `✕`
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

export function CheckIcon(props: IconProps) {
  return (
    <Glyph {...props}>
      <path d="M3.5 8.5 6.5 11.5 12.5 4.5" />
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

export function FunnelIcon(props: IconProps) {
  return (
    <Glyph {...props}>
      <path d="M2.75 3.5h10.5L9.25 8.75v4L6.75 11.5V8.75z" />
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
