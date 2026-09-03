import type { ColumnFilter, PretableSortEntry } from "@pretable/react";
import type {
  ScenarioDataset,
  ScenarioRow,
} from "@pretable-internal/scenario-data";

import type { BenchQueryState } from "./bench-types";

export interface BenchInteractionPlan {
  focusedRowId: string | null;
  filters: Record<string, ColumnFilter>;
  mode: Exclude<BenchQueryState["scriptName"], "initial" | "scroll">;
  probeColumnId: string;
  resultRowCount: number;
  rows: readonly ScenarioRow[];
  selectedRowId: string | null;
  /** Ordered multi-sort entry list; `[]` = unsorted. */
  sort: PretableSortEntry[];
  /** Grouping levels, outermost first; `[]` = ungrouped. */
  rowGroups: string[];
  /**
   * group-expand only: the group VALUE the measured window collapses — the
   * sorted-first group (the probe row deliberately sits in the SECOND group;
   * see the builder). `null` for every other mode. Carried on the plan so
   * bench-app can hand it to any adapter's collapse handle (#478) without
   * reading an adapter-specific row model.
   */
  collapsedGroupKey: string | null;
  /** group-expand only: how many data rows the collapsed group hides. */
  collapsedGroupRowCount: number;
}

export interface BenchFilterKeystrokeStep {
  /** The filter value this keystroke commits (a prefix of the full needle). */
  readonly value: string;
  readonly plan: BenchInteractionPlan;
}

/**
 * The keystroke script's needle (#509). TEXT_FILTER's "Bonjour" alone gives
 * S2/S7's value pool only TWO distinct count classes (rows containing "b" vs
 * rows containing "bonjour" — every intermediate prefix ties), so the typing
 * sequence collapsed to one cold + one warm commit and the warm distribution
 * degenerated to a single sample. Typing CONTINUES through the message text
 * into a token id, which the existing pool grades: "B" (5/6 of rows) → "Bo"
 * (1/6) → "…token-1" → "…token-12" → "…token-123" — five surviving commits at
 * dev scale and above, four at smoke, verified against the real datasets at
 * every scale. The scenario data itself is untouched, so no historical bench
 * number moves.
 *
 * The `filter-text` comparability survives as an intermediate step: under
 * monotone narrowing, equal count ⇒ equal set, and the committed "Bo" step
 * selects the byte-identical row set to `filter-text`'s "Bonjour".
 */
export const KEYSTROKE_FILTER_NEEDLE = "Bonjour depuis Pretable token-123";

/**
 * filter-as-you-type sequence for the `filter-keystrokes` script: the prefixes
 * of `KEYSTROKE_FILTER_NEEDLE`, applied as successive `contains` commits on
 * `roles.textFilter`'s column (see the needle's comment for how it relates to
 * the single-commit `filter-text` script).
 *
 * `roles` is required: a dataset that omits it must be a type error, never a
 * silent fall back to `col_0`. The needle itself is still written for the
 * multilingual corpus, so a dataset whose text column never contains it simply
 * yields no sequence (`null`).
 */
export function createBenchFilterKeystrokePlans(
  dataset: Pick<ScenarioDataset, "rows" | "roles">,
): BenchFilterKeystrokeStep[] | null {
  const { columnId } = dataset.roles.textFilter;
  const needle = KEYSTROKE_FILTER_NEEDLE;
  const prefixes = Array.from({ length: needle.length }, (_, index) =>
    needle.slice(0, index + 1),
  );

  // The settle machinery latches on a signature whose first component is the
  // result row count (visible rows can be identical across a narrowing), so a
  // step that does not move the count would starve the latch: keep only steps
  // that strictly reduce the count, starting from the unfiltered total.
  const kept: { value: string; rows: readonly ScenarioRow[] }[] = [];
  let previousCount = dataset.rows.length;
  for (const prefix of prefixes) {
    const rows = filterRows(dataset.rows, columnId, prefix);
    if (rows.length > previousCount) {
      // Monotone narrowing is structural (contains "Bo" ⊆ contains "B"); a
      // violation means filterRows and this builder disagree — a plan bug.
      throw new Error(
        `filter-keystrokes: prefix "${prefix}" widened the row set (${rows.length} > ${previousCount})`,
      );
    }
    if (rows.length === previousCount) {
      continue;
    }
    kept.push({ value: prefix, rows });
    previousCount = rows.length;
  }

  // The full needle must always be the last committed value — it is what makes
  // the final state comparable to `filter-text`. Equal count under monotone
  // narrowing means an identical row set, so swapping the last kept prefix for
  // the full needle preserves the strict decrease.
  const fullNeedle = prefixes.at(-1)!;
  if (kept.length > 0 && kept.at(-1)!.value !== fullNeedle) {
    const finalRows = filterRows(dataset.rows, columnId, fullNeedle);
    if (finalRows.length === kept.at(-1)!.rows.length) {
      kept[kept.length - 1] = { value: fullNeedle, rows: finalRows };
    } else {
      kept.push({ value: fullNeedle, rows: finalRows });
    }
  }

  if (kept.length < 2) {
    // One commit is the single-commit script; a sequence needs a warm tail.
    return null;
  }

  const finalRows = kept.at(-1)!.rows;
  const probeRow = finalRows[Math.floor(finalRows.length / 2)] ?? finalRows[0];
  const probeRowId = probeRow ? String(probeRow.id ?? "") : null;

  return kept.map(({ value, rows }) => ({
    value,
    plan: {
      focusedRowId: probeRowId,
      collapsedGroupKey: null,
      collapsedGroupRowCount: 0,
      filters: { [columnId]: { operator: "contains", value } },
      mode: "filter-keystrokes",
      probeColumnId: columnId,
      resultRowCount: rows.length,
      rows,
      rowGroups: [],
      selectedRowId: probeRowId,
      sort: [],
    },
  }));
}

/**
 * Same configuration as the engine's sibling ordering (see `compareGroupKeys`
 * in `packages/row-model/src/compiled-query.ts`), so the plan can predict which group
 * `flatten` will emit first without reaching into the engine.
 */
const groupKeyCollator = new Intl.Collator(undefined, {
  numeric: true,
  sensitivity: "base",
});

export function createBenchInteractionPlan(
  dataset: ScenarioDataset,
  scriptName: BenchQueryState["scriptName"],
): BenchInteractionPlan | null {
  // Which columns each script acts on is the dataset's to say (#PMS profile):
  // S1–S7 carry `legacyScenarioRoles`, so their plans are byte-identical to
  // the pre-roles literals these locals replaced.
  const { roles } = dataset;
  const SORT_COLUMN_ID = roles.sortColumnId;
  const METADATA_FILTER = roles.metadataFilter;
  const TEXT_FILTER = roles.textFilter;
  const GROUP_COLUMN_IDS = roles.groupColumnIds;

  if (scriptName === "sort") {
    const rows = sortRows(dataset.rows, SORT_COLUMN_ID, "desc");
    const probeRow = rows[Math.floor(rows.length / 3)] ?? rows[0];
    const probeRowId = probeRow ? String(probeRow.id ?? "") : null;

    return {
      focusedRowId: probeRowId,
      collapsedGroupKey: null,
      collapsedGroupRowCount: 0,
      filters: {},
      mode: "sort",
      probeColumnId: SORT_COLUMN_ID,
      resultRowCount: rows.length,
      rows,
      rowGroups: [],
      selectedRowId: probeRowId,
      sort: [
        {
          columnId: SORT_COLUMN_ID,
          direction: "desc",
        },
      ],
    };
  }

  if (scriptName === "filter-metadata") {
    const rows = filterRows(
      dataset.rows,
      METADATA_FILTER.columnId,
      METADATA_FILTER.value,
    );
    const probeRow = rows[Math.floor(rows.length / 2)] ?? rows[0];
    const probeRowId = probeRow ? String(probeRow.id ?? "") : null;

    return {
      focusedRowId: probeRowId,
      collapsedGroupKey: null,
      collapsedGroupRowCount: 0,
      filters: {
        [METADATA_FILTER.columnId]: {
          operator: "contains",
          value: METADATA_FILTER.value,
        },
      },
      mode: "filter-metadata",
      probeColumnId: METADATA_FILTER.columnId,
      resultRowCount: rows.length,
      rows,
      rowGroups: [],
      selectedRowId: probeRowId,
      sort: [],
    };
  }

  if (scriptName === "filter-text") {
    const rows = filterRows(
      dataset.rows,
      TEXT_FILTER.columnId,
      TEXT_FILTER.value,
    );
    const probeRow = rows[Math.floor(rows.length / 2)] ?? rows[0];
    const probeRowId = probeRow ? String(probeRow.id ?? "") : null;

    return {
      focusedRowId: probeRowId,
      collapsedGroupKey: null,
      collapsedGroupRowCount: 0,
      filters: {
        [TEXT_FILTER.columnId]: {
          operator: "contains",
          value: TEXT_FILTER.value,
        },
      },
      mode: "filter-text",
      probeColumnId: TEXT_FILTER.columnId,
      resultRowCount: rows.length,
      rows,
      rowGroups: [],
      selectedRowId: probeRowId,
      sort: [],
    };
  }

  if (scriptName === "group") {
    // Every data row stays visible (groups default to expanded), so the
    // probe row can be any row — and `selected_row_preserved` then answers a
    // real question: does applying a grouping keep the user's selection?
    const rows = dataset.rows;
    const probeRow = rows[Math.floor(rows.length / 3)] ?? rows[0];
    const probeRowId = probeRow ? String(probeRow.id ?? "") : null;

    return {
      focusedRowId: probeRowId,
      collapsedGroupKey: null,
      collapsedGroupRowCount: 0,
      filters: {},
      mode: "group",
      probeColumnId: GROUP_COLUMN_IDS[0]!,
      // The engine's row model interleaves one group row per distinct key —
      // at EVERY level — with the data rows, and `rowModelRowCount` counts
      // both.
      resultRowCount: rows.length + countGroupRows(rows, GROUP_COLUMN_IDS),
      rows,
      rowGroups: [...GROUP_COLUMN_IDS],
      selectedRowId: probeRowId,
      sort: [],
    };
  }

  if (scriptName === "group-expand") {
    // The grouping itself is applied BEFORE the measurement window (see
    // bench-app.tsx), so this plan describes the pre-window state. The window
    // contains exactly one `grid.setGroupExpanded` — the same call the twisty
    // click makes — which collapses the FIRST group in sibling order.
    //
    // The probe row is therefore taken from the SECOND group. It has to be
    // outside the collapsed one, or `reconcileFocusAfterVisibleModelChange({
    // preferAncestor })` walks focus up to the ancestor group row and the
    // preservation metrics report a collapse artifact rather than a
    // regression. Second rather than last because controlled focus scrolls
    // itself into view: a probe in the LAST group parks the viewport at the
    // end of the content, where collapsing 25% of the rows clamps scrollTop
    // and leaves two rendered rows to settle — a measurement of scroll
    // clamping, not of the toggle.
    const rows = dataset.rows;
    const outerId = GROUP_COLUMN_IDS[0]!;
    const keys = sortedGroupKeys(rows, outerId);
    const collapsedKey = keys[0] ?? null;
    const survivingKey = keys[1] ?? keys[0] ?? null;
    const probeRow =
      survivingKey === null
        ? rows[0]
        : (rows.find((row) => String(row[outerId] ?? "") === survivingKey) ??
          rows[0]);
    const probeRowId = probeRow ? String(probeRow.id ?? "") : null;
    const collapsedRows =
      collapsedKey === null
        ? []
        : rows.filter((row) => String(row[outerId] ?? "") === collapsedKey);
    // Collapsing the OUTERMOST group hides its data rows AND every group row
    // nested under it; the engine's visibleRowCount drops both. Its own group
    // row survives (it is what you click to expand again), hence the -1. With
    // a single grouping level there is nothing nested, so this is 0 and the
    // count below reduces to the pre-two-level formula exactly.
    const hiddenNestedGroupRows =
      countGroupRows(collapsedRows, GROUP_COLUMN_IDS) -
      (collapsedRows.length > 0 ? 1 : 0);

    return {
      focusedRowId: probeRowId,
      collapsedGroupKey: collapsedKey,
      collapsedGroupRowCount: collapsedRows.length,
      filters: {},
      mode: "group-expand",
      probeColumnId: outerId,
      resultRowCount:
        rows.length -
        collapsedRows.length +
        countGroupRows(rows, GROUP_COLUMN_IDS) -
        hiddenNestedGroupRows,
      rows,
      rowGroups: [...GROUP_COLUMN_IDS],
      selectedRowId: probeRowId,
      sort: [],
    };
  }

  if (
    scriptName === "group-updates" ||
    scriptName === "group-updates-stable-keys"
  ) {
    // Streaming scripts: no selection or focus probe, so the measured window
    // holds nothing but the update stream (`updates` runs with no controlled
    // state at all, and this keeps the three comparable).
    //
    // The two variants describe the SAME pre-window state and differ only in
    // which columns the patch generator may write — see
    // `benchUpdatesExcludedColumnIds` below.
    const rows = dataset.rows;

    return {
      focusedRowId: null,
      collapsedGroupKey: null,
      collapsedGroupRowCount: 0,
      filters: {},
      mode: scriptName,
      probeColumnId: GROUP_COLUMN_IDS[0]!,
      resultRowCount: rows.length + countGroupRows(rows, GROUP_COLUMN_IDS),
      rows,
      rowGroups: [...GROUP_COLUMN_IDS],
      selectedRowId: null,
      sort: [],
    };
  }

  return null;
}

/**
 * Columns the streaming patch generator must NOT write, per script.
 *
 * `updates` and `group-updates` return `[]` — their generator is byte-identical
 * and picks uniformly from every column, which is what makes them comparable.
 * Because `group-updates` groups on `roles.groupColumnIds` (`col_5` on S5),
 * that uniform pick lands on a grouping level about 1 patch in 30 there,
 * minting new group keys: the group
 * count observed in the 2026-08-10 baseline went 4 → ~100 over a 3 s run. The
 * measurement therefore conflates two different things — grouping under
 * streaming, and grouping-KEY CHURN under streaming.
 *
 * `group-updates-stable-keys` excludes the grouping levels and nothing else, so
 * rows update but never re-path between groups. That is the realistic case (a
 * price ticks; its sector does not) and the one the streaming-hero decision
 * actually needs.
 *
 * Known and deliberate asymmetry: removing one of S5's 30 columns from the pool
 * lifts every surviving column's share from 1/30 to 1/29, including the single
 * wrapped column (3.33% → 3.45% of patches). That is a ~0.1 percentage-point
 * shift in wrapped-cell hit rate and cannot account for effects of the size
 * being measured here. Restricting the pool further — say, to one fixed column
 * — would be a much larger departure from `updates`.
 */
export function benchUpdatesExcludedColumnIds(
  dataset: Pick<ScenarioDataset, "roles">,
  scriptName: BenchQueryState["scriptName"],
): readonly string[] {
  return scriptName === "group-updates-stable-keys"
    ? [...dataset.roles.groupColumnIds]
    : [];
}

/** Distinct values of `columnId`, ordered the way `flatten` emits siblings. */
export function sortedGroupKeys(
  rows: readonly ScenarioRow[],
  columnId: string,
): string[] {
  const keys = new Set<string>();

  for (const row of rows) {
    keys.add(String(row[columnId] ?? ""));
  }

  return [...keys].sort((left, right) => groupKeyCollator.compare(left, right));
}

/**
 * One group row per distinct key prefix at every level, outermost first — what
 * the engine's `visibleRowCount` adds on top of the data rows when all groups
 * are expanded.
 */
function countGroupRows(
  rows: readonly ScenarioRow[],
  columnIds: readonly string[],
) {
  let total = 0;

  for (let depth = 1; depth <= columnIds.length; depth += 1) {
    const prefixes = new Set<string>();

    for (const row of rows) {
      // JSON, not a joined string: real group values contain spaces
      // ("Consumer Discretionary"), and any separator that can appear inside a
      // value would merge two distinct key paths into one counted prefix.
      prefixes.add(
        JSON.stringify(
          columnIds.slice(0, depth).map((id) => String(row[id] ?? "")),
        ),
      );
    }

    total += prefixes.size;
  }

  return total;
}

function filterRows(
  rows: readonly ScenarioRow[],
  columnId: string,
  needle: string,
): readonly ScenarioRow[] {
  const normalizedNeedle = needle.trim().toLowerCase();

  return rows.filter((row) =>
    String(row[columnId] ?? "")
      .toLowerCase()
      .includes(normalizedNeedle),
  );
}

function sortRows(
  rows: readonly ScenarioRow[],
  columnId: string,
  direction: "asc" | "desc",
): readonly ScenarioRow[] {
  const sorted = [...rows].sort((left, right) => {
    const leftValue = Number(left[columnId] ?? 0);
    const rightValue = Number(right[columnId] ?? 0);

    return leftValue - rightValue;
  });

  return direction === "desc" ? sorted.reverse() : sorted;
}
