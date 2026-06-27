// packages/react/src/filter-menu/FilterMenu.tsx
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type JSX,
} from "react";
import type { ColumnFilter, FilterOperator, FilterType } from "@pretable/core";
import {
  OPERATOR_LABELS,
  defaultDraft,
  fromColumnFilter,
  operatorValueShape,
  operatorsForType,
  toColumnFilter,
  type FilterDraft,
} from "./filter-operators";

const DEBOUNCE_MS = 200;

export function FilterMenu({
  columnId,
  label,
  filterType,
  options,
  initialFilter,
  style,
  onChange,
  onClose,
}: {
  columnId: string;
  label: string;
  filterType: FilterType;
  options: { value: string; label?: string }[];
  initialFilter: ColumnFilter | null;
  style?: CSSProperties;
  onChange: (columnId: string, filter: ColumnFilter | null) => void;
  onClose: () => void;
}): JSX.Element {
  const [draft, setDraft] = useState<FilterDraft>(() =>
    fromColumnFilter(filterType, initialFilter),
  );

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
      onChange(columnId, toColumnFilter(filterType, next));
    },
    [columnId, filterType, onChange],
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
  useEffect(() => {
    selectRef.current?.focus();
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
  const operators = operatorsForType(filterType);
  const inputType = filterType === "date" ? "date" : "text";
  const numericProps =
    filterType === "number" ? { inputMode: "numeric" as const } : {};

  const onClear = useCallback(() => {
    clearTimer();
    setDraft(defaultDraft(filterType));
    onChange(columnId, null);
  }, [clearTimer, columnId, filterType, onChange]);

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
          {options.map((opt) => {
            const checked = (draft.selected ?? []).includes(opt.value);
            return (
              <label key={opt.value}>
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={(e) => toggleSelected(opt.value, e.target.checked)}
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
  );
}
