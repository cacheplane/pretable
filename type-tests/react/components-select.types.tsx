// TEMPORARY: imported from source because `@pretable/react` does not export
// these yet. Task 9 of the SP2 plan switches this to the package.
import {
  PretableSelect,
  type PretableSelectOption,
  type PretableSelectProps,
} from "../../packages/react/src/components/select";
import type {
  PretableBuiltInButtonSite,
  PretableButtonSite,
} from "../../packages/react/src/components/button";
import type { Equal, Expect } from "../shared/assert";

const options: readonly PretableSelectOption[] = [
  { value: "a", label: "A" },
  { value: "b", label: "B", disabled: true },
];

// The name is required.
// @ts-expect-error — aria-label is required
<PretableSelect options={options} value="a" onChange={() => {}} />;
<PretableSelect
  aria-label="Pick"
  options={options}
  value="a"
  onChange={() => {}}
/>;

// The value is a string, and onChange hands one back.
// prettier-ignore
// @ts-expect-error — value is a string
<PretableSelect aria-label="Pick" options={options} value={1} onChange={() => {}} />;
<PretableSelect
  aria-label="Pick"
  options={options}
  value="a"
  onChange={(v) => {
    const s: string = v;
    void s;
  }}
/>;

// No `type`, no children, no native onChange/value shapes leak through.
// prettier-ignore
// @ts-expect-error — the element is always type="button"
<PretableSelect aria-label="Pick" options={options} value="a" onChange={() => {}} type="submit" />;
// prettier-ignore
// @ts-expect-error — the trigger draws its own label; children are not a channel
<PretableSelect aria-label="Pick" options={options} value="a" onChange={() => {}}>x</PretableSelect>;

// The four select sites are in the kit's vocabulary, and it stays open.
<PretableSelect
  aria-label="Pick"
  options={options}
  value="a"
  onChange={() => {}}
  site="filter-operator"
/>;
<PretableSelect
  aria-label="Pick"
  options={options}
  value="a"
  onChange={() => {}}
  site="my-app-picker"
/>;
// `Extract<Union, X>` over a union containing `(string & {})` is vacuous —
// pin the built-in union directly, so removing a site from it fails this.
export type SelectSitesAreBuiltIn = Expect<
  Equal<
    Extract<
      PretableBuiltInButtonSite,
      | "aggregate"
      | "filter-row-column"
      | "filter-row-operator"
      | "filter-operator"
    >,
    | "aggregate"
    | "filter-row-column"
    | "filter-row-operator"
    | "filter-operator"
  >
>;

// Refs and native attributes flow through.
const ref = { current: null as HTMLButtonElement | null };
<PretableSelect
  ref={ref}
  aria-label="Pick"
  options={options}
  value="a"
  onChange={() => {}}
  disabled
  className="x"
/>;

export type NameIsRequired = Expect<
  Equal<PretableSelectProps["aria-label"], string>
>;

// `site` accepts the built-ins and any string.
export type SiteIsOpen = Expect<
  Equal<PretableSelectProps["site"], PretableButtonSite | undefined>
>;
