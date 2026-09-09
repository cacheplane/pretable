import { usePretableComponents } from "../components/context";
import { createElement, useId, useState } from "react";

import type { PretableFocusDirection } from "@pretable/core";
import {
  MAX_DATE_VALUE,
  MIN_DATE_VALUE,
  addDateValueDays,
  addDateValueMonths,
  isValidDateValue,
  dateValueToUtcMs,
} from "@pretable-internal/calendar-date";

import { useOverlayContainer } from "../overlay/portal-context";
import { OverlayPortal } from "../overlay/OverlayPortal";
import { popoverStyle } from "../overlay/popover-position";
import type { PretableEditorInput } from "../types";
import { monthLabel, monthMatrix, todayIso } from "./date-utils";
import { editorCommitDirection } from "./editor-keyboard";
import { useEditorAnchor } from "./use-editor-anchor";
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
  readonly navigating: boolean;
  readonly observedDraft: unknown;
  readonly cursor: string;
  readonly selected: string | null;
  readonly userModified: boolean;
  readonly userDraft: unknown;
}

const initialState = (
  draft: unknown,
  seededFromTyping: boolean,
): DateEditorState => {
  const canonical = isValidDateValue(draft) ? draft : null;
  return {
    navigating: false,
    observedDraft: draft,
    cursor: canonical ?? todayIso(),
    selected: canonical,
    userModified: seededFromTyping,
    userDraft: draft,
  };
};

export function DateCellEditor({ input }: { input: PretableEditorInput }) {
  const { TextInput, IconButton } = usePretableComponents();
  const { attachRef, pending, fieldProps, isComposing } =
    useEditorField<HTMLInputElement>(input);
  const gridId = useId();
  const overlayReady = useOverlayContainer() !== null;
  const { anchorRef, rect } = useEditorAnchor(overlayReady);
  const [storedState, setStoredState] = useState<DateEditorState>(() =>
    initialState(input.draft, input.seededFromTyping ?? false),
  );

  let state = storedState;
  if (!Object.is(state.observedDraft, input.draft)) {
    const canonical = isValidDateValue(input.draft) ? input.draft : null;
    const reflectsUserWrite =
      state.userModified && Object.is(state.userDraft, input.draft);
    state = {
      navigating: reflectsUserWrite && state.navigating,
      observedDraft: input.draft,
      cursor: canonical ?? state.cursor,
      selected: canonical,
      userModified: reflectsUserWrite,
      userDraft: input.draft,
    };
    setStoredState(state);
  }

  const text = String(input.draft ?? "");
  const active = state.cursor;
  const weeks = monthMatrix(active);
  const today = todayIso();
  const previousMonthDisabled =
    pending || active.slice(0, 7) === MIN_DATE_VALUE.slice(0, 7);
  const nextMonthDisabled =
    pending || active.slice(0, 7) === MAX_DATE_VALUE.slice(0, 7);

  const writeUserDraft = (next: string, selected: string | null) => {
    setStoredState({
      navigating: true,
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
    if (pending) return;
    setStoredState({ ...state, cursor: next, navigating: true });
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
      (typeof state.userDraft === "string" && state.userDraft.trim() === "") ||
      isValidDateValue(state.userDraft)
    ) {
      input.commit();
    } else {
      input.cancel();
    }
  };

  return (
    <span ref={anchorRef} data-pretable-date-editor="">
      <TextInput
        site="cell-editor"
        ref={attachRef}
        className="pretable-cell-editor"
        role="combobox"
        aria-haspopup="grid"
        aria-expanded={overlayReady}
        inputMode="numeric"
        placeholder="YYYY-MM-DD"
        aria-controls={overlayReady ? gridId : undefined}
        aria-activedescendant={overlayReady ? `${gridId}-${active}` : undefined}
        value={text}
        onChange={(event) => {
          if (pending) return;
          const next = event.target.value;
          const canonical = isValidDateValue(next) ? next : null;
          setStoredState({
            navigating: false,
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
          if (isComposing(event)) return;
          if (
            !state.navigating &&
            ["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)
          )
            return;
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
          if (
            state.navigating &&
            (event.key === "Home" || event.key === "End")
          ) {
            event.preventDefault();
            event.stopPropagation();
            const day =
              (new Date(dateValueToUtcMs(active)).getUTCDay() + 6) % 7;
            move(
              addDateValueDays(active, event.key === "Home" ? -day : 6 - day),
            );
            return;
          }
          if (event.key === "Enter" && state.navigating) {
            event.preventDefault();
            event.stopPropagation();
            choose(active, editorCommitDirection(event));
            return;
          }
          fieldProps.onKeyDown(event);
        }}
      />
      <OverlayPortal>
        <div
          data-pretable-date-popover=""
          style={popoverStyle(rect)}
          onMouseDown={(event) => event.preventDefault()}
        >
          <div data-pretable-date-header="">
            <IconButton
              tabIndex={-1}
              aria-label="Previous month"
              site="date-previous-month"
              data-pretable-date-previous-month=""
              disabled={previousMonthDisabled}
              onClick={() => move(addDateValueMonths(active, -1))}
            >
              ‹
            </IconButton>
            <span>{monthLabel(active)}</span>
            <IconButton
              tabIndex={-1}
              aria-label="Next month"
              site="date-next-month"
              data-pretable-date-next-month=""
              disabled={nextMonthDisabled}
              onClick={() => move(addDateValueMonths(active, 1))}
            >
              ›
            </IconButton>
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
                      aria-disabled={pending || day.disabled || undefined}
                      data-pretable-date-day=""
                      data-pretable-date-active={
                        day.iso === active ? "" : undefined
                      }
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
