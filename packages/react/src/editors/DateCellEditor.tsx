import { useId, useLayoutEffect, useRef, useState } from "react";

import type { PretableFocusDirection } from "@pretable/core";
import {
  MAX_DATE_VALUE,
  MIN_DATE_VALUE,
  addDateValueDays,
  addDateValueMonths,
  isValidDateValue,
} from "@pretable-internal/calendar-date";

import { OverlayPortal } from "../overlay/OverlayPortal";
import { popoverStyle } from "../overlay/popover-position";
import type { PretableEditorInput } from "../types";
import { monthLabel, monthMatrix, todayIso } from "./date-utils";
import { useEditorField } from "./use-editor-field";

const WEEKDAYS = [
  ["Mo", "Monday"],
  ["Tu", "Tuesday"],
  ["We", "Wednesday"],
  ["Th", "Thursday"],
  ["Fr", "Friday"],
  ["Sa", "Saturday"],
  ["Su", "Sunday"],
] as const;

interface DateEditorState {
  readonly observedDraft: unknown;
  readonly cursor: string;
  readonly selected: string | null;
  readonly userModified: boolean;
  readonly userDraft: unknown;
}

const initialState = (draft: unknown): DateEditorState => {
  const canonical = isValidDateValue(draft) ? draft : null;
  return {
    observedDraft: draft,
    cursor: canonical ?? todayIso(),
    selected: canonical,
    userModified: false,
    userDraft: draft,
  };
};

export function DateCellEditor({ input }: { input: PretableEditorInput }) {
  const { ref, pending, fieldProps } = useEditorField<HTMLInputElement>(input);
  const gridId = useId();
  const anchorRef = useRef<HTMLSpanElement>(null);
  const [rect, setRect] = useState<DOMRect | null>(null);
  const [storedState, setStoredState] = useState<DateEditorState>(() =>
    initialState(input.draft),
  );

  let state = storedState;
  if (!Object.is(state.observedDraft, input.draft)) {
    const canonical = isValidDateValue(input.draft) ? input.draft : null;
    const reflectsUserWrite =
      state.userModified && Object.is(state.userDraft, input.draft);
    state = {
      observedDraft: input.draft,
      cursor: canonical ?? state.cursor,
      selected: canonical,
      userModified: reflectsUserWrite,
      userDraft: input.draft,
    };
    setStoredState(state);
  }

  useLayoutEffect(() => {
    const measure = () => {
      if (anchorRef.current) setRect(anchorRef.current.getBoundingClientRect());
    };
    measure();
    window.addEventListener("scroll", measure, true);
    window.addEventListener("resize", measure);
    return () => {
      window.removeEventListener("scroll", measure, true);
      window.removeEventListener("resize", measure);
    };
  }, []);

  const text = String(input.draft ?? "");
  const active = state.cursor;
  const weeks = monthMatrix(active);
  const today = todayIso();
  const previousMonthDisabled =
    active.slice(0, 7) === MIN_DATE_VALUE.slice(0, 7);
  const nextMonthDisabled = active.slice(0, 7) === MAX_DATE_VALUE.slice(0, 7);

  const writeUserDraft = (next: string, selected: string | null) => {
    setStoredState({
      observedDraft: input.draft,
      cursor: selected ?? state.cursor,
      selected,
      userModified: true,
      userDraft: next,
    });
    input.setDraft(next);
  };

  const choose = (iso: string, direction?: PretableFocusDirection) => {
    if (pending) return;
    writeUserDraft(iso, iso);
    if (direction) input.commit(direction);
    else input.commit();
  };

  const move = (next: string) => {
    if (pending || next === state.cursor) return;
    writeUserDraft(next, next);
  };

  const blur = () => {
    if (input.status !== "editing") return;
    if (!state.userModified) {
      if (input.column.parseEditValue) input.cancel();
      else if (input.draft === null || isValidDateValue(input.draft))
        input.commit();
      else input.cancel();
      return;
    }
    if (
      input.column.parseEditValue ||
      state.userDraft === "" ||
      isValidDateValue(state.userDraft)
    ) {
      input.commit();
    } else {
      input.cancel();
    }
  };

  return (
    <span ref={anchorRef} data-pretable-date-editor="">
      <input
        ref={ref}
        className="pretable-cell-editor"
        inputMode="numeric"
        placeholder="YYYY-MM-DD"
        aria-controls={gridId}
        aria-activedescendant={`${gridId}-${active}`}
        value={text}
        onChange={(event) => {
          const next = event.target.value;
          const canonical = isValidDateValue(next) ? next : null;
          setStoredState({
            observedDraft: input.draft,
            cursor: canonical ?? state.cursor,
            selected: canonical,
            userModified: true,
            userDraft: next,
          });
          input.setDraft(next);
        }}
        {...fieldProps}
        onBlur={blur}
        onKeyDown={(event) => {
          const step =
            event.key === "ArrowLeft"
              ? -1
              : event.key === "ArrowRight"
                ? 1
                : event.key === "ArrowUp"
                  ? -7
                  : event.key === "ArrowDown"
                    ? 7
                    : 0;
          if (step !== 0) {
            event.preventDefault();
            event.stopPropagation();
            move(addDateValueDays(active, step));
            return;
          }
          if (event.key === "PageUp" || event.key === "PageDown") {
            event.preventDefault();
            event.stopPropagation();
            move(addDateValueMonths(active, event.key === "PageDown" ? 1 : -1));
            return;
          }
          if (event.key === "Enter" && state.selected !== null) {
            event.preventDefault();
            event.stopPropagation();
            choose(state.selected, "down");
            return;
          }
          fieldProps.onKeyDown(event);
        }}
      />
      <OverlayPortal>
        <div
          data-pretable-date-popover=""
          style={rect ? popoverStyle(rect) : undefined}
          onMouseDown={(event) => event.preventDefault()}
        >
          <div data-pretable-date-header="">
            <button
              type="button"
              tabIndex={-1}
              aria-label="Previous month"
              disabled={previousMonthDisabled}
              onClick={() => move(addDateValueMonths(active, -1))}
            >
              ‹
            </button>
            <span>{monthLabel(active)}</span>
            <button
              type="button"
              tabIndex={-1}
              aria-label="Next month"
              disabled={nextMonthDisabled}
              onClick={() => move(addDateValueMonths(active, 1))}
            >
              ›
            </button>
          </div>
          <div id={gridId} role="grid" aria-label={monthLabel(active)}>
            <div role="row" data-pretable-date-weekdays="">
              {WEEKDAYS.map(([short, full]) => (
                <span key={short} role="columnheader" aria-label={full}>
                  {short}
                </span>
              ))}
            </div>
            {weeks.map((week, weekIndex) => (
              <div role="row" key={weekIndex}>
                {week.map((day, dayIndex) => {
                  const id =
                    day.iso === null
                      ? `${gridId}-disabled-${weekIndex}-${dayIndex}`
                      : `${gridId}-${day.iso}`;
                  return (
                    <span
                      key={id}
                      id={id}
                      role="gridcell"
                      aria-label={day.iso ?? undefined}
                      aria-selected={
                        day.iso === null
                          ? undefined
                          : day.iso === state.selected
                      }
                      aria-disabled={day.disabled || undefined}
                      data-pretable-date-day=""
                      data-pretable-date-outside={day.inMonth ? undefined : ""}
                      data-pretable-date-today={
                        day.iso === today ? "" : undefined
                      }
                      onClick={
                        day.iso === null ? undefined : () => choose(day.iso!)
                      }
                    >
                      {day.day}
                    </span>
                  );
                })}
              </div>
            ))}
          </div>
        </div>
      </OverlayPortal>
    </span>
  );
}
