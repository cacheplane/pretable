// packages/react/src/filter-menu/FilterMenu.tsx
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type JSX,
} from "react";
import type {
  ColumnFilter,
  ColumnOption,
  FilterOperator,
  ColumnType,
  PretableDistinctValueQuery,
} from "@pretable/core";
import {
  OPERATOR_LABELS,
  defaultDraft,
  fromColumnFilter,
  menuOperators,
  operatorValueShape,
  toColumnFilter,
  type FilterDraft,
} from "./filter-operators";
import { OverlayPortal } from "../overlay/OverlayPortal";

const DEBOUNCE_MS = 200;

type DistinctValueLoader = (
  columnId: string,
) => PretableDistinctValueQuery<string>;

type DistinctValueState =
  | { readonly kind: "idle" }
  | {
      readonly kind: "ready";
      readonly columnId: string;
      readonly loader: DistinctValueLoader;
      readonly options: readonly ColumnOption[];
    }
  | {
      readonly kind: "error";
      readonly columnId: string;
      readonly loader: DistinctValueLoader;
    };

type VisibleDistinctValueState =
  DistinctValueState | { readonly kind: "loading" };

export function FilterMenu({
  columnId,
  label,
  type,
  allowedOperators,
  options,
  initialFilter,
  style,
  loadDistinctValues,
  onChange,
  onClose,
}: {
  columnId: string;
  label: string;
  type: ColumnType;
  allowedOperators?: readonly FilterOperator[];
  options: readonly ColumnOption[];
  initialFilter: ColumnFilter | null;
  style?: CSSProperties;
  loadDistinctValues?: DistinctValueLoader;
  onChange: (columnId: string, filter: ColumnFilter | null) => void;
  onClose: () => void;
}): JSX.Element {
  const [draft, setDraft] = useState<FilterDraft>(() =>
    fromColumnFilter(type, initialFilter, allowedOperators),
  );
  const [distinctValueState, setDistinctValueState] =
    useState<DistinctValueState>({ kind: "idle" });

  const rootRef = useRef<HTMLDivElement>(null);
  const selectRef = useRef<HTMLSelectElement>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Keep the latest draft in a ref so the unmount flush sees current state.
  // Synced in an effect (not during render) so the ref write is not a render
  // side effect; the flush only fires on unmount, after this has run.
  const latestDraftRef = useRef(draft);
  useEffect(() => {
    latestDraftRef.current = draft;
  }, [draft]);

  const apply = useCallback(
    (next: FilterDraft) => {
      onChange(columnId, toColumnFilter(type, next));
    },
    [columnId, type, onChange],
  );

  const clearTimer = useCallback(() => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  // Immediate apply (operator/checkbox/date changes).
  const pushNow = useCallback(
    (next: FilterDraft) => {
      clearTimer();
      setDraft(next);
      apply(next);
    },
    [apply, clearTimer],
  );

  // Debounced apply (free-text/number typing).
  const pushDebounced = useCallback(
    (next: FilterDraft) => {
      setDraft(next);
      clearTimer();
      timerRef.current = setTimeout(() => {
        timerRef.current = null;
        apply(next);
      }, DEBOUNCE_MS);
    },
    [apply, clearTimer],
  );

  // Flush any pending debounced apply on unmount.
  useEffect(() => {
    return () => {
      if (timerRef.current !== null) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
        apply(latestDraftRef.current);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Focus the operator select on mount.
  //
  // `preventScroll` no longer decides whether this popover survives its own
  // mount — `useHeaderPopover` follows its anchor now instead of closing on
  // any window scroll, so a scrolling `.focus()` would be repositioned rather
  // than fatal. It stays because scrolling the page is not something opening a
  // menu should do to the reader in the first place: the popover is drawn
  // beside a header the user was already looking at, and yanking the document
  // to reveal a control inside it moves everything else out from under them.
  //
  // Kept as the historical record of why it was added, because the shape is
  // worth recognising again: opening the filter from the keyboard for the
  // FIRST time on a page failed in both engines, 1 of 3 reps each, always the
  // first — the only open with any scrolling left to do. Every later open was
  // already in view and therefore silent. It read as flaky and was
  // deterministic.
  useEffect(() => {
    selectRef.current?.focus({ preventScroll: true });
  }, []);

  // Outside-click → close.
  useEffect(() => {
    const onPointerDown = (e: PointerEvent) => {
      const root = rootRef.current;
      if (root && e.target instanceof Node && !root.contains(e.target)) {
        onClose();
      }
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [onClose]);

  const onOperatorChange = useCallback(
    (operator: FilterOperator) => {
      const shape = operatorValueShape(operator);
      let next: FilterDraft;
      if (shape === "none") next = { operator };
      else if (shape === "set")
        // Keep prior selection only when staying within a set shape.
        next = {
          operator,
          selected:
            operatorValueShape(draft.operator) === "set"
              ? (draft.selected ?? [])
              : [],
        };
      else if (shape === "range") next = { operator, min: "", max: "" };
      else next = { operator, text: "" };
      pushNow(next);
    },
    [draft, pushNow],
  );

  const shape = operatorValueShape(draft.operator);
  // `menuOperators`, not `operatorsForType`: the draft hydrates from the
  // APPLIED filter, so it can hold an operator this column's
  // `filterOperators` prunes — and a <select> whose value matches no option
  // displays a different one, naming a filter the grid is not applying and
  // leaving the real one unreachable. The tool panel's leaf row reaches the
  // same case by the same route.
  const operators = menuOperators(type, draft.operator, allowedOperators);
  const inputType = type === "date" ? "date" : "text";
  const numericProps =
    type === "number" ? { inputMode: "numeric" as const } : {};

  const shouldLoadDistinctValues =
    shape === "set" &&
    type === "enum" &&
    options.length === 0 &&
    loadDistinctValues !== undefined;

  useEffect(() => {
    if (!shouldLoadDistinctValues || loadDistinctValues === undefined) return;

    let active = true;

    let query: PretableDistinctValueQuery<string>;
    try {
      query = loadDistinctValues(columnId);
    } catch {
      void Promise.resolve().then(() => {
        if (!active) return;
        setDistinctValueState({
          kind: "error",
          columnId,
          loader: loadDistinctValues,
        });
      });
      return () => {
        active = false;
      };
    }

    void query.finished.then(
      (result) => {
        if (!active) return;
        setDistinctValueState({
          kind: "ready",
          columnId,
          loader: loadDistinctValues,
          options: result.values.map(({ value }) => ({ value })),
        });
      },
      () => {
        if (!active) return;
        setDistinctValueState({
          kind: "error",
          columnId,
          loader: loadDistinctValues,
        });
      },
    );

    return () => {
      active = false;
      query.cancel();
    };
  }, [columnId, loadDistinctValues, shouldLoadDistinctValues]);

  const visibleDistinctValueState: VisibleDistinctValueState =
    !shouldLoadDistinctValues || loadDistinctValues === undefined
      ? { kind: "idle" }
      : distinctValueState.kind !== "idle" &&
          distinctValueState.columnId === columnId &&
          distinctValueState.loader === loadDistinctValues
        ? distinctValueState
        : { kind: "loading" };

  const visibleOptions =
    options.length > 0
      ? options
      : visibleDistinctValueState.kind === "ready"
        ? visibleDistinctValueState.options
        : [];

  const onClear = useCallback(() => {
    clearTimer();
    setDraft(defaultDraft(type, allowedOperators));
    onChange(columnId, null);
  }, [allowedOperators, clearTimer, columnId, type, onChange]);

  const toggleSelected = useCallback(
    (value: string, checked: boolean) => {
      const current = new Set(draft.selected ?? []);
      if (checked) current.add(value);
      else current.delete(value);
      pushNow({ ...draft, selected: [...current] });
    },
    [draft, pushNow],
  );

  return (
    <OverlayPortal>
      <div
        ref={rootRef}
        role="dialog"
        aria-label={`Filter ${label}`}
        data-pretable-filter-menu=""
        data-pretable-popover=""
        style={style}
      >
        <select
          ref={selectRef}
          data-pretable-filter-operator=""
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
            type={inputType}
            {...numericProps}
            data-pretable-filter-value=""
            aria-label={`Filter value`}
            value={draft.text ?? ""}
            onChange={(e) =>
              inputType === "date"
                ? pushNow({ ...draft, text: e.target.value })
                : pushDebounced({ ...draft, text: e.target.value })
            }
          />
        ) : null}

        {shape === "range" ? (
          <>
            <input
              type={inputType}
              {...numericProps}
              data-pretable-filter-min=""
              aria-label="Filter minimum"
              value={draft.min ?? ""}
              onChange={(e) =>
                inputType === "date"
                  ? pushNow({ ...draft, min: e.target.value })
                  : pushDebounced({ ...draft, min: e.target.value })
              }
            />
            <input
              type={inputType}
              {...numericProps}
              data-pretable-filter-max=""
              aria-label="Filter maximum"
              value={draft.max ?? ""}
              onChange={(e) =>
                inputType === "date"
                  ? pushNow({ ...draft, max: e.target.value })
                  : pushDebounced({ ...draft, max: e.target.value })
              }
            />
          </>
        ) : null}

        {shape === "set" ? (
          <div
            data-pretable-filter-set=""
            role="group"
            aria-label="Filter values"
          >
            {visibleDistinctValueState.kind === "loading" ? (
              <div role="status" data-pretable-filter-values-loading="">
                Loading filter values…
              </div>
            ) : null}
            {visibleDistinctValueState.kind === "error" ? (
              <div role="alert" data-pretable-filter-values-error="">
                Unable to load filter values.
              </div>
            ) : null}
            {visibleOptions.map((opt) => {
              const checked = (draft.selected ?? []).includes(opt.value);
              return (
                <label key={opt.value}>
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={(e) =>
                      toggleSelected(opt.value, e.target.checked)
                    }
                  />
                  {opt.label ?? opt.value}
                </label>
              );
            })}
          </div>
        ) : null}

        <button type="button" data-pretable-filter-clear="" onClick={onClear}>
          Clear
        </button>
      </div>
    </OverlayPortal>
  );
}
