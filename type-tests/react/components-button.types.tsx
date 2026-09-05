import {
  PretableButton,
  PretableIconButton,
  type PretableBuiltInButtonSite,
  type PretableButtonProps,
  type PretableButtonSite,
  type PretableComponents,
  type PretableIconButtonProps,
} from "@pretable/react";
import type { Equal, Expect } from "../shared/assert";

// An icon-only button has no accessible name but the one it is given, so
// omitting it is a compile error — a WCAG failure the grid could otherwise
// ship becomes one the compiler refuses.
// @ts-expect-error — aria-label is required on an icon button
<PretableIconButton onClick={() => {}} />;
<PretableIconButton aria-label="Remove" />;

// The element is always type="button"; the prop does not exist.
// @ts-expect-error — `type` is not a prop
<PretableButton type="submit">x</PretableButton>;
// @ts-expect-error — `type` is not a prop on the icon button either
<PretableIconButton aria-label="x" type="submit" />;

// A site is a built-in name or any string, never a type error — and the
// built-ins keep their autocomplete, which a collapse to bare `string` would
// lose. Both halves pinned at once.
<PretableButton site="filter-clear">x</PretableButton>;
<PretableButton site="my-app-export">x</PretableButton>;
export type SiteIsOpenAndKeepsBuiltIns = Expect<
  Equal<PretableButtonSite, PretableBuiltInButtonSite | (string & {})>
>;

// The variant is closed.
<PretableButton variant="link">x</PretableButton>;
// @ts-expect-error — only the two shipped looks exist
<PretableButton variant="solid">x</PretableButton>;

// Every native button attribute flows through, refs included.
const ref = { current: null as HTMLButtonElement | null };
<PretableButton ref={ref} aria-describedby="why" disabled tabIndex={-1}>
  x
</PretableButton>;
<PretableIconButton ref={ref} aria-label="x" aria-expanded={false} />;

// The props types are what a replacement is written against.
export type ButtonHasSite = Expect<
  Equal<PretableButtonProps["site"], PretableButtonSite | undefined>
>;
export type IconHasName = Expect<
  Equal<PretableIconButtonProps["aria-label"], string>
>;

// A replacement is written against the same props the built-in receives, and
// the built-ins themselves satisfy the slot types.
const components: PretableComponents = {
  Button: PretableButton,
  IconButton: PretableIconButton,
};
export type ComponentsIsOptional = Expect<
  Equal<PretableComponents["Button"], PretableComponents["Button"] | undefined>
>;
void components;

// Every slot may be OMITTED, not merely set to undefined.
const empty: PretableComponents = {};
void empty;
