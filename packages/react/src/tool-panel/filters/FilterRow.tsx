import type {
  ColumnOption,
  ColumnType,
  FilterOperator,
  PretableProcessingOptions,
} from "@pretable/core";
import type { ReactNode } from "react";

import { optionLabel } from "../../editors/enum-options";
import {
  defaultDraft,
  operatorsForType,
  operatorValueShape,
  resolveColumnOptions,
  OPERATOR_LABELS,
  type FilterDraft,
} from "../../filter-menu/filter-operators";
import { CloseIcon } from "../../icons";

/**
 * One choosable column, restated structurally the way `ColumnsSection` restates
 * a layout entry: the row reads these five fields and nothing else, so naming
 * them here keeps the component clear of the engine's generic parameters.
 */
export interface FilterRowColumn {
  readonly id: string;
  /** `header ?? id` — the surface's `labelForColumn`, already resolved. */
  readonly label: string;
  /** Absent means `text`, the same default the funnel menu assumes. */
  readonly type?: ColumnType;
  /** Declared enum choices. Absent falls back to `distinctValues`. */
  readonly options?: ColumnOption[];
  /** `column.filterOperators`, if the column narrows the type's set. */
  readonly filterOperators?: readonly FilterOperator[];
  /**
   * Hidden by the column-visibility feature. Present only when `true` — the
   * engine's own encoding, and `ColumnsSection`'s.
   */
  readonly hidden?: boolean;
}

/** What one leaf of the tree holds. The section owns where it sits. */
export interface FilterRowLeaf {
  readonly columnId: string;
  readonly draft: FilterDraft;
}

export interface FilterRowProps {
  /** The columns a leaf may filter on, in the order the picker offers them. */
  readonly columns: readonly FilterRowColumn[];
  readonly columnId: string;
  readonly draft: FilterDraft;
  /**
   * The run's connective, rendered as this row's first child. A SLOT, not a
   * prop the row understands: the join belongs to the sibling run, not to any
   * one leaf (`JoinControl`'s TSDoc argues why), and only the section knows
   * the run. Absent for a row rendered outside a run.
   */
  readonly join?: ReactNode;
  /**
   * The whole leaf, always — never a partial patch. Changing the column can
   * change the operator too, and a caller that had to merge two callbacks
   * could observe the impossible pair in between.
   */
  readonly onChange: (next: FilterRowLeaf) => void;
  readonly onRemove: () => void;
  /**
   * Distinct values for an enum column that declares no `options`, read only
   * through `resolveColumnOptions` (which is where the incomplete-universe
   * warning under external filtering lives).
   */
  readonly distinctValues?: (columnId: string) => string[];
  /** Passed through to `resolveColumnOptions` for that same warning. */
  readonly processing?: PretableProcessingOptions;
}

/**
 * One leaf of the filter tree: `join · column · operator · value · remove`,
 * inline in a 264px pane.
 *
 * Presentational and fully controlled — no state, no effects, no engine
 * handle. The section owns the tree, the paths and the commit.
 *
 * ## The operator list is not re-derived here
 *
 * Which operators a type allows, what they are called, which value shape each
 * one takes, and what an empty draft for a type looks like all come from
 * `filter-menu/filter-operators`. The funnel menu and this row must offer the
 * same filters or the same tree would read differently in two places; a second
 * derivation is how they drift.
 *
 * ## Changing the column re-derives the operator
 *
 * A leaf whose column moves from `Name` to `Revenue` cannot keep `contains` —
 * no number filter evaluates it, so the row would name a filter the engine
 * cannot run. When the operator survives the move it is kept, along with the
 * value the user typed; only when it cannot does the leaf fall back to
 * `defaultDraft(newType)`. Resetting unconditionally would be simpler and
 * would throw away work on every column change.
 *
 * ## Why the cell editors are NOT used here
 *
 * `editors/` is the obvious source for a typed value control, and every one of
 * them was read before this was written. They are cell editors in the exact
 * sense that rules them out:
 *
 * 1. They take a `PretableEditorInput` — an engine edit-lifecycle handle with
 *    `rowId`, `columnId`, `status`, `commit(direction)` and `cancel()`. A
 *    filter draft has no row, no cell and no in-flight save to model; the
 *    adapter would be a fake edit session per row.
 * 2. `useEditorField` FOCUSES ON MOUNT, commits on blur, commits on Enter and
 *    Tab, and cancels on Escape. In a builder that is: every added row steals
 *    focus, and tabbing between a row's own controls commits and closes.
 * 3. `.pretable-cell-editor` is cell geometry — `width: 100%; height: 100%`,
 *    which in this wrapping 264px row puts the value on a line of its own —
 *    and it carries `[aria-busy="true"] { opacity: 0.7 }`, which would dim a
 *    builder control by opacity through a selector this section's no-opacity
 *    guard cannot see.
 * 4. `EnumCellEditor` is a STRICT SINGLE-SELECT combobox. `isAnyOf` is a set.
 *    It is the wrong control before any of the above matters.
 * 5. `BooleanCellControl` sets one cell's boolean. A boolean COLUMN filters
 *    with `isAnyOf` over True/False, which is again a set — the same checklist
 *    an enum gets, populated by `resolveColumnOptions`.
 *
 * So the controls below are primitives, and the reuse is the part that
 * actually transfers: the operator vocabulary above, plus `resolveColumnOptions`
 * and `optionLabel` for the choices. The funnel menu — the other consumer of
 * that vocabulary, and a popover of the same controls — reaches for the same
 * primitives for the same reasons.
 *
 * ## Remove is 24px, not the chip's 14px
 *
 * `[data-pretable-chip-remove]` is the nearest reusable remove control and is
 * 14x14 — below WCAG 2.5.8's 24px minimum, in a section that bought 24px for
 * both controls it already owned. It gets this section's own treatment rather
 * than the chip's, in its own rule, guarded like the join and the add actions.
 */
export function FilterRow({
  columns,
  columnId,
  draft,
  join,
  onChange,
  onRemove,
  distinctValues,
  processing,
}: FilterRowProps) {
  const column = columns.find((c) => c.id === columnId);
  const type = column?.type ?? "text";
  const label = column?.label ?? columnId;
  const hidden = column?.hidden === true;

  const operators = operatorsForType(type, column?.filterOperators);
  const shape = operatorValueShape(draft.operator);

  const push = (next: FilterDraft) => onChange({ columnId, draft: next });

  const onColumnChange = (nextId: string) => {
    const next = columns.find((c) => c.id === nextId);
    const nextType = next?.type ?? "text";
    const allowed = operatorsForType(nextType, next?.filterOperators);
    onChange({
      columnId: nextId,
      draft: allowed.includes(draft.operator)
        ? draft
        : defaultDraft(nextType, next?.filterOperators),
    });
  };

  const onOperatorChange = (operator: FilterOperator) => {
    const nextShape = operatorValueShape(operator);
    // Same-shape moves keep the value (`contains` -> `startsWith` over the
    // same text); a shape change has nowhere to put the old one.
    if (nextShape === operatorValueShape(draft.operator)) {
      push({ ...draft, operator });
      return;
    }
    if (nextShape === "none") push({ operator });
    else if (nextShape === "set") push({ operator, selected: [] });
    else if (nextShape === "range") push({ operator, min: "", max: "" });
    else push({ operator, text: "" });
  };

  // Only an enum-style column reaches a checklist, and `resolveColumnOptions`
  // is what decides that — including the boolean column's implicit True/False.
  const choices = column
    ? resolveColumnOptions(
        { id: column.id, type: column.type, options: column.options },
        () => distinctValues?.(column.id) ?? [],
        processing,
      )
    : [];

  const toggle = (value: string, checked: boolean) => {
    const selected = new Set(draft.selected ?? []);
    if (checked) selected.add(value);
    else selected.delete(value);
    // Rebuilt in the option order rather than in click order, so the same set
    // of choices always produces the same filter value.
    push({
      ...draft,
      selected: choices.map((o) => o.value).filter((v) => selected.has(v)),
    });
  };

  // `date` gets the native picker the funnel menu uses; `number` gets
  // `inputMode="decimal"` rather than the funnel's `numeric`, because a filter
  // bound is routinely negative or fractional and `numeric` offers a keypad
  // with neither sign nor separator.
  const fieldProps =
    type === "date"
      ? { type: "date" }
      : type === "number"
        ? { type: "text", inputMode: "decimal" as const }
        : { type: "text" };

  return (
    <div
      data-pretable-filter-row=""
      {...(hidden ? { "data-pretable-filter-column-hidden": "true" } : {})}
    >
      {join}

      <select
        data-pretable-filter-row-column=""
        // The state is in the NAME, not only in the row's dim colour: colour
        // alone is SC 1.4.1 (Use of Colour), and this picker is where a
        // screen-reader user meets the column.
        aria-label={hidden ? "Filter column, hidden" : "Filter column"}
        value={columnId}
        onChange={(e) => onColumnChange(e.target.value)}
      >
        {columns.map((c) => (
          <option key={c.id} value={c.id}>
            {c.label}
          </option>
        ))}
      </select>

      <select
        data-pretable-filter-row-operator=""
        aria-label="Filter operator"
        value={draft.operator}
        onChange={(e) => onOperatorChange(e.target.value as FilterOperator)}
      >
        {operators.map((op) => (
          <option key={op} value={op}>
            {OPERATOR_LABELS[op]}
          </option>
        ))}
      </select>

      {shape === "single" ? (
        <input
          {...fieldProps}
          data-pretable-filter-row-value=""
          aria-label="Filter value"
          value={draft.text ?? ""}
          onChange={(e) => push({ ...draft, text: e.target.value })}
        />
      ) : null}

      {shape === "range" ? (
        <>
          <input
            {...fieldProps}
            data-pretable-filter-row-value=""
            aria-label="Filter minimum"
            value={draft.min ?? ""}
            onChange={(e) => push({ ...draft, min: e.target.value })}
          />
          <input
            {...fieldProps}
            data-pretable-filter-row-value=""
            aria-label="Filter maximum"
            value={draft.max ?? ""}
            onChange={(e) => push({ ...draft, max: e.target.value })}
          />
        </>
      ) : null}

      {shape === "set" ? (
        <div
          data-pretable-filter-row-value=""
          role="group"
          aria-label="Filter values"
        >
          {choices.map((option) => (
            <label key={option.value}>
              <input
                type="checkbox"
                value={option.value}
                checked={(draft.selected ?? []).includes(option.value)}
                onChange={(e) => toggle(option.value, e.target.checked)}
              />
              {optionLabel(option)}
            </label>
          ))}
        </div>
      ) : null}

      {/* `isEmpty` / `isNotEmpty` render nothing here: the operator IS the
          whole filter, and an inert input beside it would invite a value the
          engine discards. */}

      <button
        type="button"
        data-pretable-filter-row-remove=""
        // Named by what it removes. A pane of these is otherwise a list of
        // identical `Remove` buttons, which is exactly what a screen-reader
        // user's element list would show.
        aria-label={`Remove filter on ${label}`}
        onClick={onRemove}
      >
        <CloseIcon />
      </button>
    </div>
  );
}
