import type { ColumnOption } from "@pretable/core";

/** The text shown for an option — its `label`, or the raw `value`. */
export function optionLabel(option: ColumnOption): string {
  return option.label ?? option.value;
}

/**
 * The option a typed string selects: an exact (case-insensitive) label match
 * first, then an exact value match. Blank text selects nothing.
 */
export function matchOption(
  options: readonly ColumnOption[],
  text: string,
): ColumnOption | undefined {
  const needle = text.trim().toLowerCase();
  if (needle === "") return undefined;
  return (
    options.find((o) => optionLabel(o).toLowerCase() === needle) ??
    options.find((o) => o.value.toLowerCase() === needle)
  );
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
