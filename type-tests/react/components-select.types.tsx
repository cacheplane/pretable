import {
  PretableSelect,
  type PretableBuiltInSite,
  type PretableComponents,
  type PretableSelectComponent,
  type PretableSelectOption,
  type PretableSelectProps,
  type PretableSite,
} from "@pretable/react";
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
// Pins all fourteen non-button sites: the four select sites plus the ten
// input and checkbox sites (SP3).
export type SelectSitesAreBuiltIn = Expect<
  Equal<
    Extract<
      PretableBuiltInSite,
      | "aggregate"
      | "filter-row-column"
      | "filter-row-operator"
      | "filter-operator"
      | "filter-value"
      | "filter-row-value"
      | "tool-search"
      | "row-select"
      | "row-select-all"
      | "bool-cell"
      | "tool-column-toggle"
      | "hide-grouped"
      | "filter-choice"
      | "filter-row-choice"
    >,
    | "aggregate"
    | "filter-row-column"
    | "filter-row-operator"
    | "filter-operator"
    | "filter-value"
    | "filter-row-value"
    | "tool-search"
    | "row-select"
    | "row-select-all"
    | "bool-cell"
    | "tool-column-toggle"
    | "hide-grouped"
    | "filter-choice"
    | "filter-row-choice"
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
  Equal<PretableSelectProps["site"], PretableSite | undefined>
>;

// The built-in satisfies its own slot type, and a replacement is written
// against `PretableSelectProps` like every other kit component.
const components: PretableComponents = { Select: PretableSelect };
void components;
const slot: PretableSelectComponent = PretableSelect;
void slot;

const textOptions: readonly PretableSelectOption[] = [
  { value: "number", label: 42 },
  { value: "override", label: "Displayed", textValue: "Searchable" },
  { value: "rich", label: <span>Rich</span>, textValue: "Rich" },
  { value: "empty", label: null, textValue: "Empty" },
];
void textOptions;
// @ts-expect-error — rich labels require explicit typeahead text
const missingRichText: PretableSelectOption = {
  value: "rich",
  label: <span>Rich</span>,
};
// @ts-expect-error — non-primitive labels also require explicit text
const missingEmptyText: PretableSelectOption = { value: "empty", label: null };
void missingRichText;
void missingEmptyText;
