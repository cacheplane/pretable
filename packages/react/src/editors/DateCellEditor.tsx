import { useId, useLayoutEffect, useRef, useState } from "react";

import type { PretableFocusDirection } from "@pretable/core";

import { OverlayPortal } from "../overlay/OverlayPortal";
import { popoverStyle } from "../overlay/popover-position";
import type { PretableEditorInput } from "../types";
import {
  addDaysIso,
  addMonthsIso,
  isValidIsoDate,
  monthLabel,
  monthMatrix,
  toIsoDate,
  todayIso,
} from "./date-utils";
import { useEditorField } from "./use-editor-field";

const WEEKDAYS = ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"];

/**
 * Date editor: a strict ISO field plus a month grid in a portaled popover.
 *
 * DOM focus stays in the input — moving it into the grid would fire the shared
 * chrome's blur-commit — so the active day is published with
 * `aria-activedescendant` and arrow keys drive the calendar rather than the
 * text caret (the field is a fixed 10-character date).
 */
export function DateCellEditor({ input }: { input: PretableEditorInput }) {
  const { ref, pending, fieldProps } = useEditorField<HTMLInputElement>(input);
  const gridId = useId();
  const anchorRef = useRef<HTMLSpanElement>(null);
  const [rect, setRect] = useState<DOMRect | null>(null);
  const text = String(input.draft ?? "");
  // `cursor` is the single source of truth for what the calendar shows and
  // highlights: arrows/PageUp/Down move it, and typing a valid date syncs it.
  // (Deriving it from the draft text instead would make the calendar lag the
  // engine round-trip.)
  const [cursor, setCursor] = useState(
    () => toIsoDate(input.draft ?? input.value) || todayIso(),
  );

  useLayoutEffect(() => {
    const measure = () => {
      if (anchorRef.current) setRect(anchorRef.current.getBoundingClientRect());
    };
    measure();
    // The popover is portaled and `position: fixed`, so it detaches visually
    // when anything scrolls. Capture phase catches grid-internal scrollers.
    window.addEventListener("scroll", measure, true);
    window.addEventListener("resize", measure);
    return () => {
      window.removeEventListener("scroll", measure, true);
      window.removeEventListener("resize", measure);
    };
  }, []);

  // The controller seeds the draft with the raw cell value, which may be a
  // Date or a timestamp; show it as ISO so the field matches what commits.
  useLayoutEffect(() => {
    const seeded = String(input.draft ?? "");
    const iso = toIsoDate(input.draft);
    if (iso && iso !== seeded) input.setDraft(iso);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const active = cursor;
  const weeks = monthMatrix(active);
  const today = todayIso();

  const choose = (iso: string, direction?: PretableFocusDirection) => {
    if (pending) return;
    // setDraft mutates engine state synchronously, so the commit that follows
    // reads the day we just wrote.
    input.setDraft(iso);
    if (direction) input.commit(direction);
    else input.commit();
  };

  const move = (next: string) => {
    // Same guard as `choose`: the field is readOnly while an edit is in flight,
    // so navigation must not rewrite the draft behind a pending save either.
    if (pending) return;
    setCursor(next);
    // Keep the field and the calendar in step while navigating.
    input.setDraft(next);
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
        onChange={(e) => {
          const next = e.target.value;
          input.setDraft(next);
          // A complete, valid date retargets the calendar as you type.
          if (isValidIsoDate(next)) setCursor(next);
        }}
        {...fieldProps}
        onBlur={() => {
          // Clicking away with an unparseable date reverts rather than leaving
          // a rejected edit stuck open on the cell.
          if (input.status !== "editing") return;
          if (text.trim() === "" || isValidIsoDate(text)) input.commit();
          else input.cancel();
        }}
        onKeyDown={(e) => {
          const step =
            e.key === "ArrowLeft"
              ? -1
              : e.key === "ArrowRight"
                ? 1
                : e.key === "ArrowUp"
                  ? -7
                  : e.key === "ArrowDown"
                    ? 7
                    : 0;
          if (step !== 0) {
            e.preventDefault();
            e.stopPropagation();
            move(addDaysIso(active, step));
            return;
          }
          if (e.key === "PageUp" || e.key === "PageDown") {
            e.preventDefault();
            e.stopPropagation();
            move(addMonthsIso(active, e.key === "PageDown" ? 1 : -1));
            return;
          }
          // Enter takes the highlighted day, but only when the typed text is
          // itself a valid date — so garbage still reaches the parser's reject
          // and an empty field still commits null, instead of silently
          // committing whatever the calendar happened to be showing.
          if (e.key === "Enter" && isValidIsoDate(text)) {
            e.preventDefault();
            e.stopPropagation();
            choose(active, "down");
            return;
          }
          // Escape, Tab, an empty field, and an invalid draft fall through to
          // the shared chrome — parseDraftForType rejects what it can't read.
          fieldProps.onKeyDown(e);
        }}
      />
      <OverlayPortal>
        <div
          data-pretable-date-popover=""
          style={rect ? popoverStyle(rect) : undefined}
          // Keep focus in the input; a blur would commit or revert before the
          // click lands (same hazard as the enum listbox).
          onMouseDown={(e) => e.preventDefault()}
        >
          <div data-pretable-date-header="">
            <button
              type="button"
              tabIndex={-1}
              aria-label="Previous month"
              onClick={() => move(addMonthsIso(active, -1))}
            >
              ‹
            </button>
            <span>{monthLabel(active)}</span>
            <button
              type="button"
              tabIndex={-1}
              aria-label="Next month"
              onClick={() => move(addMonthsIso(active, 1))}
            >
              ›
            </button>
          </div>
          <div id={gridId} role="grid" aria-label={monthLabel(active)}>
            <div role="row" data-pretable-date-weekdays="">
              {WEEKDAYS.map((w) => (
                <span key={w} role="columnheader" aria-label={w}>
                  {w}
                </span>
              ))}
            </div>
            {weeks.map((week) => (
              <div role="row" key={week[0].iso}>
                {week.map((d) => (
                  <span
                    key={d.iso}
                    id={`${gridId}-${d.iso}`}
                    role="gridcell"
                    aria-label={d.iso}
                    aria-selected={d.iso === active}
                    data-pretable-date-day=""
                    data-pretable-date-outside={d.inMonth ? undefined : ""}
                    data-pretable-date-today={d.iso === today ? "" : undefined}
                    onClick={() => choose(d.iso)}
                  >
                    {d.day}
                  </span>
                ))}
              </div>
            ))}
          </div>
        </div>
      </OverlayPortal>
    </span>
  );
}
