// TEMPORARY: imported from source because `@pretable/react` does not export
// these yet. Task 9 of the SP3 plan switches this to the package.
import {
  PretableCheckbox,
  type PretableCheckboxProps,
} from "../../packages/react/src/components/checkbox";
import {
  PretableTextInput,
  type PretableTextInputProps,
} from "../../packages/react/src/components/text-input";
import type {
  PretableBuiltInSite,
  PretableSite,
} from "../../packages/react/src/components/button";
import type { Equal, Expect } from "../shared/assert";

// --- PretableCheckbox ---------------------------------------------------

// `checked` is required.
// prettier-ignore
// @ts-expect-error — checked is required
<PretableCheckbox onCheckedChange={() => {}} />;

// `onCheckedChange` is required.
// prettier-ignore
// @ts-expect-error — onCheckedChange is required
<PretableCheckbox checked={false} />;

// `checked` is `boolean | "mixed"`, not an arbitrary string.
// prettier-ignore
// @ts-expect-error — checked is boolean | "mixed", not an arbitrary string
<PretableCheckbox checked="yes" onCheckedChange={() => {}} />;

// "mixed" is a valid checked state — the header select-all's partial state.
<PretableCheckbox checked="mixed" onCheckedChange={() => {}} />;
<PretableCheckbox checked={true} onCheckedChange={() => {}} />;

// No `type`, `role`, native `onChange`, or children leak through — the
// element is always type="button" role="checkbox" with its own aria-checked
// wired to `checked`. (`aria-checked` itself is not tested here: TypeScript
// special-cases `aria-*`/`data-*` attributes on every JSX element, so no
// props type — Omit or not — can make one a type error.)
// prettier-ignore
// @ts-expect-error — the element is always type="button"
<PretableCheckbox checked={false} onCheckedChange={() => {}} type="submit" />;
// prettier-ignore
// @ts-expect-error — the element is always role="checkbox"
<PretableCheckbox checked={false} onCheckedChange={() => {}} role="switch" />;
// prettier-ignore
// @ts-expect-error — the native onChange is not a channel; use onCheckedChange
<PretableCheckbox checked={false} onCheckedChange={() => {}} onChange={() => {}} />;
// prettier-ignore
// @ts-expect-error — the glyph is drawn from checked; children are not a channel
<PretableCheckbox checked={false} onCheckedChange={() => {}}>x</PretableCheckbox>;

// The checkbox sites are in the kit's vocabulary, and it stays open.
<PretableCheckbox
  checked={false}
  onCheckedChange={() => {}}
  site="row-select"
/>;
<PretableCheckbox checked={false} onCheckedChange={() => {}} site="mine" />;

// Refs are typed to the button, not the input.
const checkboxRef = { current: null as HTMLButtonElement | null };
<PretableCheckbox
  ref={checkboxRef}
  checked={false}
  onCheckedChange={() => {}}
/>;
const wrongCheckboxRef = { current: null as HTMLInputElement | null };
// prettier-ignore
// @ts-expect-error — the ref is HTMLButtonElement, not HTMLInputElement
<PretableCheckbox ref={wrongCheckboxRef} checked={false} onCheckedChange={() => {}} />;

// `onCheckedChange` hands back a plain boolean.
<PretableCheckbox
  checked="mixed"
  onCheckedChange={(v) => {
    const b: boolean = v;
    void b;
  }}
/>;

export type CheckedIsBooleanOrMixed = Expect<
  Equal<PretableCheckboxProps["checked"], boolean | "mixed">
>;

// --- PretableTextInput ---------------------------------------------------

// Native input attributes pass straight through: `type`, `inputMode`,
// `value` and `onChange` keep their native shapes.
<PretableTextInput
  aria-label="When"
  type="date"
  value="2026-01-01"
  onChange={() => {}}
/>;
<PretableTextInput aria-label="Amount" inputMode="decimal" />;
<PretableTextInput
  aria-label="Filter value"
  value="x"
  onChange={(e) => {
    const s: string = e.target.value;
    void s;
  }}
/>;

// prettier-ignore
// @ts-expect-error — the native element draws its own value; children are not a channel
<PretableTextInput aria-label="x">text</PretableTextInput>;

// Refs are typed to the input.
const textInputRef = { current: null as HTMLInputElement | null };
<PretableTextInput ref={textInputRef} aria-label="x" />;

// The kit's own sites are in the vocabulary, and it stays open.
<PretableTextInput aria-label="Filter value" site="filter-value" />;

export type TextInputSiteIsOpen = Expect<
  Equal<PretableTextInputProps["site"], PretableSite | undefined>
>;

// --- The ten SP3 sites are pinned in PretableBuiltInSite -----------------

type TenSp3Sites =
  | "filter-value"
  | "filter-row-value"
  | "tool-search"
  | "row-select"
  | "row-select-all"
  | "bool-cell"
  | "tool-column-toggle"
  | "hide-grouped"
  | "filter-choice"
  | "filter-row-choice";

// `Extract<Union, X>` over a union containing `(string & {})` is vacuous —
// pin the built-in union directly, so removing a site from it fails this.
export type Sp3SitesAreBuiltIn = Expect<
  Equal<Extract<PretableBuiltInSite, TenSp3Sites>, TenSp3Sites>
>;

// The negative twin: simulate a site dropping out of the union (as SP2's
// reviewer did with `button.tsx`, without touching the file) and prove the
// pin can actually fail.
// prettier-ignore
// @ts-expect-error — removing a site must break the pin
export type RemovingASiteBreaksThePin = Expect<Equal<Extract<Exclude<PretableBuiltInSite, "hide-grouped">, TenSp3Sites>, TenSp3Sites>>;
