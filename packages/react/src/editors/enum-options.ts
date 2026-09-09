import type { ColumnOption } from "@pretable/core";

/** The text shown for an option — its `label`, or the raw `value`. */
export function optionLabel(option: ColumnOption): string {
  return option.label ?? option.value;
}

/**
 * Typed text resolves only when label/value matches identify one distinct
 * value. Blank or ambiguous text selects nothing.
 */
export function matchOption(
  options: readonly ColumnOption[],
  text: string,
): ColumnOption | undefined {
  const needle = text.trim().toLowerCase();
  if (needle === "") return undefined;
  const matches = options.filter(
    (option) =>
      optionLabel(option).toLowerCase() === needle ||
      option.value.toLowerCase() === needle,
  );
  return new Set(matches.map((option) => option.value)).size === 1
    ? matches[0]
    : undefined;
}

/** Typeahead filter: substring over label and value. Blank text keeps all. */
export function filterOptions(
  options: readonly ColumnOption[],
  text: string,
): ColumnOption[] {
  const needle = text.trim().toLowerCase();
  if (needle === "") return [...options];
  return options.filter(
    (o) =>
      optionLabel(o).toLowerCase().includes(needle) ||
      o.value.toLowerCase().includes(needle),
  );
}
