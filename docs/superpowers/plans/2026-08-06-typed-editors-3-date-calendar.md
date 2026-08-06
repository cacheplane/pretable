# Typed Cell Editors — Sub-project 3 (Date calendar) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the date cell editor — an ISO text field plus a pretable-skinned month grid in a portaled popover — completing the typed-editors series.

**Architecture:** Mirrors the shipped `EnumCellEditor` exactly: the engine draft holds the input text, the popover renders through `overlay/OverlayPortal` (the grid viewport's `contain: content` traps and clips `position: fixed`), and `parseDraftForType` owns strictness. All date math is pure, UTC-based, and lives in a separately-tested `date-utils.ts` — no date library.

**Tech Stack:** TypeScript, React 19, vitest + @testing-library/react (jsdom), api-extractor, vanilla CSS (`@layer pretable`, `:where()`, `--pretable-*` tokens).

**Spec:** `docs/superpowers/specs/2026-08-05-typed-cell-editors-design.md` §4.5.

**Branch:** `typed-editors-3` (already created off latest `origin/main`).

---

## Two deliberate refinements of spec §4.5 (decide once, here)

1. **Focus stays in the input; the calendar is driven by `aria-activedescendant`, not roving tabindex.** §4.5 says "roving tabindex", but moving DOM focus into the portaled grid fires the input's `blur`, and the shared chrome commits on blur — the exact hazard that bit the number steppers and the combobox listbox. Keeping focus in the field removes the hazard entirely and matches the shipped combobox. The `grid`/`row`/`gridcell` roles from §4.5 are kept; the input points at the active day with `aria-activedescendant`.
2. **Arrow keys navigate the calendar, not the text caret.** Left/Right move ±1 day, Up/Down ±7. The field is a fixed 10-character ISO date, so caret movement is low-value; picking a nearby day is the common action. Correction is Backspace/retype (the field is select-all'd on open). Document this in the docs task.

Everything else in §4.5 stands: ISO `yyyy-mm-dd` value convention, PageUp/PageDown for months, today + selected marked, invalid typed input rejected, Escape cancels, blur commits when valid else reverts, and **out of scope**: time-of-day, ranges, min/max, locale-configurable week start (ISO Monday start).

---

## Verified ground truth (don't re-derive)

- `packages/react/src/editors/EnumCellEditor.tsx` is the template: `useEditorField` for chrome, a mount `useLayoutEffect` that measures the anchor and re-measures on capture-phase `scroll` + `resize`, a one-shot seed-normalisation effect, `OverlayPortal` + `popoverStyle(rect)` for the popover, `onMouseDown={(e) => e.preventDefault()}` on the popover so clicking it never blurs the input, and a `choose()` that does `setDraft(x)` then `commit()` (engine drafts are synchronous, so the commit reads what was just written). Its `commit` call shape matters: pass a direction or call `commit()` with **no** argument.
- `packages/react/src/editors/type-parsing.ts` — `parseDraftForType(column, draft)` with `number` and `enum` branches; `default` passes through. Its doc comment still says "Date validity joins here in sub-project 3."
- `packages/react/src/cell-editor.tsx` — `editorFor()` order: number → enum(with options) → text+wrap multiline → text. The comment says date falls back to text "until sub-project 3".
- `packages/react/src/overlay/` — `OverlayPortal` (portals to `document.body`, `useSyncExternalStore` hydration gate) and `popover-position.ts` (`popoverStyle(rect)`, fixed, width 240).
- **Engine date convention** (`packages/grid-core/src/evaluate-filter.ts:29-35`): `toDayMs` parses to UTC midnight via `Date.UTC(getUTCFullYear, getUTCMonth, getUTCDate)`. Match this — all math UTC, day resolution.
- `packages/ui/src/grid.css` — filter menu and enum listbox blocks are the skin precedent; both re-declare `font-family: var(--pretable-font-sans)` because portaled content loses it (the declaration lives on `[data-pretable-scroll-viewport]`, not on a `:root` token). The cascade test enforces `:where()`-wrapping on every selector.

---

## File structure

Create:

- `packages/react/src/editors/date-utils.ts` — pure UTC date helpers.
- `packages/react/src/editors/DateCellEditor.tsx` — the editor.
- Tests: `packages/react/src/__tests__/{date-utils,date-cell-editor}.test.{ts,tsx}`.

Modify:

- `packages/react/src/editors/type-parsing.ts` — strict date branch.
- `packages/react/src/cell-editor.tsx` — date dispatch.
- `packages/ui/src/grid.css` (+ `__tests__/css-cascade.test.ts`) — calendar skin.
- `apps/website/content/docs/grid/editing.mdx` — date editor docs.

---

## Task 1: Pure date helpers (TDD)

**Files:**

- Create: `packages/react/src/editors/date-utils.ts`
- Test: `packages/react/src/__tests__/date-utils.test.ts` (create)

- [ ] **Step 1: Write the failing tests** — create `packages/react/src/__tests__/date-utils.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import {
  addDaysIso,
  addMonthsIso,
  isValidIsoDate,
  monthLabel,
  monthMatrix,
  toIsoDate,
} from "../editors/date-utils";

describe("date-utils", () => {
  it("validates strict yyyy-mm-dd only", () => {
    expect(isValidIsoDate("2026-08-06")).toBe(true);
    expect(isValidIsoDate("2026-8-6")).toBe(false); // not zero-padded
    expect(isValidIsoDate("08/06/2026")).toBe(false); // locale format
    expect(isValidIsoDate("nope")).toBe(false);
    expect(isValidIsoDate("")).toBe(false);
  });

  it("rejects calendar overflow instead of rolling forward", () => {
    expect(isValidIsoDate("2026-02-30")).toBe(false);
    expect(isValidIsoDate("2026-13-01")).toBe(false);
    expect(isValidIsoDate("2024-02-29")).toBe(true); // leap year
    expect(isValidIsoDate("2026-02-29")).toBe(false);
  });

  it("normalises cell values of every shape to ISO", () => {
    expect(toIsoDate("2026-08-06")).toBe("2026-08-06");
    expect(toIsoDate(new Date(Date.UTC(2026, 7, 6)))).toBe("2026-08-06");
    expect(toIsoDate(Date.UTC(2026, 7, 6))).toBe("2026-08-06");
    expect(toIsoDate("2026-08-06T12:34:56Z")).toBe("2026-08-06");
    expect(toIsoDate(null)).toBe("");
    expect(toIsoDate("")).toBe("");
    expect(toIsoDate("not a date")).toBe("");
  });

  it("adds days across month and year boundaries", () => {
    expect(addDaysIso("2026-08-06", 1)).toBe("2026-08-07");
    expect(addDaysIso("2026-08-31", 1)).toBe("2026-09-01");
    expect(addDaysIso("2026-01-01", -1)).toBe("2025-12-31");
    expect(addDaysIso("2026-08-06", 7)).toBe("2026-08-13");
  });

  it("adds months, clamping to the target month's length", () => {
    expect(addMonthsIso("2026-08-06", 1)).toBe("2026-09-06");
    expect(addMonthsIso("2026-01-31", 1)).toBe("2026-02-28");
    expect(addMonthsIso("2024-01-31", 1)).toBe("2024-02-29"); // leap
    expect(addMonthsIso("2026-01-15", -1)).toBe("2025-12-15");
  });

  it("builds six Monday-start weeks covering the month", () => {
    const weeks = monthMatrix("2026-08-06");
    expect(weeks).toHaveLength(6);
    expect(weeks.every((w) => w.length === 7)).toBe(true);
    // 2026-08-01 is a Saturday, so the grid starts Monday 2026-07-27.
    expect(weeks[0][0].iso).toBe("2026-07-27");
    expect(weeks[0][0].inMonth).toBe(false);
    expect(weeks[0][5].iso).toBe("2026-08-01");
    expect(weeks[0][5].inMonth).toBe(true);
    // Every in-month day appears exactly once.
    const inMonth = weeks.flat().filter((d) => d.inMonth);
    expect(inMonth).toHaveLength(31);
  });

  it("labels the month of the given date", () => {
    expect(monthLabel("2026-08-06")).toBe("August 2026");
    expect(monthLabel("2025-12-01")).toBe("December 2025");
  });
});
```

- [ ] **Step 2: Run, verify FAIL** — `pnpm --filter @pretable/react test -- date-utils` → `Cannot find module '../editors/date-utils'`.

- [ ] **Step 3: Implement `packages/react/src/editors/date-utils.ts`:**

```ts
const ISO_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const DAY_MS = 86_400_000;
const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

/** A UTC-midnight timestamp as `yyyy-mm-dd`. */
function formatUtc(ms: number): string {
  const d = new Date(ms);
  return [
    String(d.getUTCFullYear()).padStart(4, "0"),
    String(d.getUTCMonth() + 1).padStart(2, "0"),
    String(d.getUTCDate()).padStart(2, "0"),
  ].join("-");
}

/**
 * Strict `yyyy-mm-dd` → UTC-midnight ms, or NaN. Deliberately refuses locale
 * formats: `03/04` is ambiguous, and the filter engine speaks ISO too.
 */
export function parseIsoDate(text: string): number {
  const trimmed = text.trim();
  if (!ISO_RE.test(trimmed)) return Number.NaN;
  const [y, m, d] = trimmed.split("-").map(Number);
  const ms = Date.UTC(y, m - 1, d);
  // Date.UTC rolls 2026-02-30 forward to March; the round-trip catches that.
  return formatUtc(ms) === trimmed ? ms : Number.NaN;
}

export function isValidIsoDate(text: string): boolean {
  return !Number.isNaN(parseIsoDate(text));
}

/** Any cell value (ISO string, `Date`, timestamp, datetime string) → `yyyy-mm-dd`, or "". */
export function toIsoDate(value: unknown): string {
  if (value === null || value === undefined || value === "") return "";
  if (typeof value === "string" && isValidIsoDate(value)) return value.trim();
  const ms =
    value instanceof Date
      ? value.getTime()
      : typeof value === "number"
        ? value
        : Date.parse(String(value));
  if (Number.isNaN(ms)) return "";
  const d = new Date(ms);
  return formatUtc(
    Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()),
  );
}

export function todayIso(): string {
  const now = new Date();
  return formatUtc(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()));
}

export function addDaysIso(iso: string, days: number): string {
  const ms = parseIsoDate(iso);
  if (Number.isNaN(ms)) return iso;
  return formatUtc(ms + days * DAY_MS);
}

/** Add months, clamping the day to the target month's length (Jan 31 + 1 → Feb 28). */
export function addMonthsIso(iso: string, months: number): string {
  const ms = parseIsoDate(iso);
  if (Number.isNaN(ms)) return iso;
  const d = new Date(ms);
  const year = d.getUTCFullYear();
  const month = d.getUTCMonth() + months;
  const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  return formatUtc(Date.UTC(year, month, Math.min(d.getUTCDate(), lastDay)));
}

export function monthLabel(iso: string): string {
  const ms = parseIsoDate(iso);
  if (Number.isNaN(ms)) return "";
  const d = new Date(ms);
  return `${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

export interface CalendarDay {
  iso: string;
  day: number;
  inMonth: boolean;
}

/** Six Monday-start weeks covering the month containing `iso`. */
export function monthMatrix(iso: string): CalendarDay[][] {
  const ms = parseIsoDate(iso);
  if (Number.isNaN(ms)) return [];
  const d = new Date(ms);
  const month = d.getUTCMonth();
  const first = Date.UTC(d.getUTCFullYear(), month, 1);
  // getUTCDay is 0=Sunday; shift so Monday is column 0.
  const offset = (new Date(first).getUTCDay() + 6) % 7;
  const start = first - offset * DAY_MS;
  return Array.from({ length: 6 }, (_, w) =>
    Array.from({ length: 7 }, (_, i) => {
      const cur = new Date(start + (w * 7 + i) * DAY_MS);
      return {
        iso: formatUtc(cur.getTime()),
        day: cur.getUTCDate(),
        inMonth: cur.getUTCMonth() === month,
      };
    }),
  );
}
```

- [ ] **Step 4: Run, verify PASS** — `pnpm --filter @pretable/react test -- date-utils` (7 tests).

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(react): pure UTC date helpers for the date cell editor"
```

---

## Task 2: Strict date parsing (TDD)

**Files:**

- Modify: `packages/react/src/editors/type-parsing.ts`
- Test: `packages/react/src/__tests__/type-parsing.test.ts` (extend)

- [ ] **Step 1: Write the failing tests** — append to `type-parsing.test.ts`:

```ts
describe("parseDraftForType — date", () => {
  const column = { type: "date" as const };

  it("accepts a strict ISO date", () => {
    expect(parseDraftForType(column, "2026-08-06")).toEqual({
      ok: true,
      value: "2026-08-06",
    });
  });

  it("normalises a Date instance or timestamp draft to ISO", () => {
    expect(parseDraftForType(column, new Date(Date.UTC(2026, 7, 6)))).toEqual({
      ok: true,
      value: "2026-08-06",
    });
  });

  it("commits null for an empty draft", () => {
    expect(parseDraftForType(column, "")).toEqual({ ok: true, value: null });
  });

  it("rejects locale formats and nonsense", () => {
    expect(parseDraftForType(column, "08/06/2026")).toEqual({
      ok: false,
      message: "Use YYYY-MM-DD",
    });
    expect(parseDraftForType(column, "nope")).toEqual({
      ok: false,
      message: "Use YYYY-MM-DD",
    });
  });

  it("rejects calendar overflow", () => {
    expect(parseDraftForType(column, "2026-02-30")).toEqual({
      ok: false,
      message: "Use YYYY-MM-DD",
    });
  });
});
```

- [ ] **Step 2: Run, verify FAIL** — date drafts currently fall through `default` unchanged.

- [ ] **Step 3: Implement** — in `type-parsing.ts`, import the helpers and add the case above `default`:

```ts
import { isValidIsoDate, toIsoDate } from "./date-utils";
```

```ts
    case "date": {
      if (draft === null || draft === undefined || draft === "")
        return { ok: true, value: null };
      // A Date/timestamp draft (a cell value that never went through the
      // editor) normalises; typed text must be strict ISO.
      if (typeof draft !== "string") {
        const iso = toIsoDate(draft);
        return iso
          ? { ok: true, value: iso }
          : { ok: false, message: "Use YYYY-MM-DD" };
      }
      const raw = draft.trim();
      if (raw === "") return { ok: true, value: null };
      return isValidIsoDate(raw)
        ? { ok: true, value: raw }
        : { ok: false, message: "Use YYYY-MM-DD" };
    }
```

Update the doc comment: drop the "Date validity joins here in sub-project 3." sentence (it has).

- [ ] **Step 4: Run, verify PASS; full react suite green**

Run: `pnpm --filter @pretable/react test`

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(react): strict ISO date draft parsing"
```

---

## Task 3: DateCellEditor + dispatch (TDD)

**Files:**

- Create: `packages/react/src/editors/DateCellEditor.tsx`
- Modify: `packages/react/src/cell-editor.tsx`
- Test: `packages/react/src/__tests__/date-cell-editor.test.tsx` (create)

- [ ] **Step 1: Write the failing tests** — create `packages/react/src/__tests__/date-cell-editor.test.tsx`:

```tsx
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { CellEditor } from "../cell-editor";
import type { PretableEditorInput } from "../types";

afterEach(cleanup);

function makeInput(
  over: Partial<PretableEditorInput> = {},
): PretableEditorInput {
  return {
    rowId: "r1",
    columnId: "due",
    row: { id: "r1", due: "2026-08-06" },
    column: { id: "due", header: "Due", type: "date" },
    value: "2026-08-06",
    status: "editing",
    draft: "2026-08-06",
    setDraft: vi.fn(),
    commit: vi.fn(),
    cancel: vi.fn(),
    ...over,
  } as PretableEditorInput;
}

const activeDay = () =>
  screen.getByRole("textbox").getAttribute("aria-activedescendant");
const dayCell = (iso: string) =>
  screen.getByRole("gridcell", { name: new RegExp(`^${iso}$`) });

describe("DateCellEditor (via dispatcher)", () => {
  it("renders a month grid for the drafted date, marking the selection", () => {
    render(<CellEditor input={makeInput()} />);
    expect(screen.getByRole("grid")).toBeInTheDocument();
    expect(screen.getByText("August 2026")).toBeInTheDocument();
    expect(dayCell("2026-08-06")).toHaveAttribute("aria-selected", "true");
  });

  it("ArrowRight moves the active day by one, ArrowDown by a week", () => {
    render(<CellEditor input={makeInput()} />);
    const box = screen.getByRole("textbox");
    const start = activeDay();
    fireEvent.keyDown(box, { key: "ArrowRight" });
    expect(activeDay()).not.toBe(start);
    expect(activeDay()).toBe(dayCell("2026-08-07").id);
    fireEvent.keyDown(box, { key: "ArrowDown" });
    expect(activeDay()).toBe(dayCell("2026-08-14").id);
  });

  it("PageDown moves to the next month", () => {
    render(<CellEditor input={makeInput()} />);
    fireEvent.keyDown(screen.getByRole("textbox"), { key: "PageDown" });
    expect(screen.getByText("September 2026")).toBeInTheDocument();
  });

  it("Enter commits the active day and moves down", () => {
    const setDraft = vi.fn();
    const commit = vi.fn();
    render(<CellEditor input={makeInput({ setDraft, commit })} />);
    const box = screen.getByRole("textbox");
    fireEvent.keyDown(box, { key: "ArrowRight" });
    fireEvent.keyDown(box, { key: "Enter" });
    expect(setDraft).toHaveBeenCalledWith("2026-08-07");
    expect(commit).toHaveBeenCalledWith("down");
  });

  it("clicking a day commits it in place", () => {
    const setDraft = vi.fn();
    const commit = vi.fn();
    render(<CellEditor input={makeInput({ setDraft, commit })} />);
    fireEvent.click(dayCell("2026-08-20"));
    expect(setDraft).toHaveBeenCalledWith("2026-08-20");
    expect(commit).toHaveBeenCalledWith();
  });

  it("typing a valid ISO date retargets the calendar", () => {
    render(<CellEditor input={makeInput()} />);
    fireEvent.change(screen.getByRole("textbox"), {
      target: { value: "2026-12-25" },
    });
    expect(screen.getByText("December 2026")).toBeInTheDocument();
    expect(dayCell("2026-12-25")).toHaveAttribute("aria-selected", "true");
  });

  it("Enter falls through to the parser when the typed text is not a date", () => {
    const setDraft = vi.fn();
    const commit = vi.fn();
    render(
      <CellEditor input={makeInput({ draft: "nope", setDraft, commit })} />,
    );
    fireEvent.keyDown(screen.getByRole("textbox"), { key: "Enter" });
    // The calendar's day is NOT substituted for what the user typed.
    expect(setDraft).not.toHaveBeenCalled();
    expect(commit).toHaveBeenCalledWith("down");
  });

  it("mousedown on the popover is default-prevented so the input never blurs", () => {
    render(<CellEditor input={makeInput()} />);
    const notPrevented = fireEvent.mouseDown(screen.getByRole("grid"));
    expect(notPrevented).toBe(false);
  });

  it("blur commits a valid date and reverts an invalid one", () => {
    const commit = vi.fn();
    const cancel = vi.fn();
    render(<CellEditor input={makeInput({ commit, cancel })} />);
    fireEvent.blur(screen.getByRole("textbox"));
    expect(commit).toHaveBeenCalledWith();
    cleanup();

    const commit2 = vi.fn();
    const cancel2 = vi.fn();
    render(
      <CellEditor
        input={makeInput({ draft: "nope", commit: commit2, cancel: cancel2 })}
      />,
    );
    fireEvent.blur(screen.getByRole("textbox"));
    expect(cancel2).toHaveBeenCalled();
    expect(commit2).not.toHaveBeenCalled();
  });

  it("Escape cancels; Tab commits right", () => {
    const commit = vi.fn();
    const cancel = vi.fn();
    render(<CellEditor input={makeInput({ commit, cancel })} />);
    const box = screen.getByRole("textbox");
    fireEvent.keyDown(box, { key: "Tab" });
    expect(commit).toHaveBeenCalledWith("right");
    fireEvent.keyDown(box, { key: "Escape" });
    expect(cancel).toHaveBeenCalled();
  });

  it("re-seeds the field as ISO when the cell holds a Date instance", () => {
    const setDraft = vi.fn();
    render(
      <CellEditor
        input={makeInput({
          draft: new Date(Date.UTC(2026, 7, 6)),
          value: new Date(Date.UTC(2026, 7, 6)),
          setDraft,
        })}
      />,
    );
    expect(setDraft).toHaveBeenCalledWith("2026-08-06");
  });
});
```

- [ ] **Step 2: Run, verify FAIL** — `pnpm --filter @pretable/react test -- date-cell-editor` (date currently dispatches to the text editor: no grid).

- [ ] **Step 3: Implement `packages/react/src/editors/DateCellEditor.tsx`:**

```tsx
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
```

- [ ] **Step 4: Dispatch date columns** — in `packages/react/src/cell-editor.tsx`, import `DateCellEditor` and add the branch after the enum one; update the trailing comment:

```tsx
if (type === "date") return <DateCellEditor input={input} />;
```

```tsx
// boolean never reaches this popover path (the cell control commits
// directly); an enum column without options behaves as text.
```

- [ ] **Step 5: Run the tests, verify PASS; full suite + gates**

Run: `pnpm --filter @pretable/react test && pnpm --filter @pretable/react typecheck && pnpm --filter @pretable/react lint`

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(react): date cell editor — strict ISO field with a month-grid popover"
```

---

## Task 4: Calendar skin

**Files:**

- Modify: `packages/ui/src/grid.css`, `packages/ui/src/__tests__/css-cascade.test.ts`

- [ ] **Step 1: Add the failing presence assertion** — append to `css-cascade.test.ts`:

```ts
test("grid.css styles the date calendar popover", () => {
  const css = fs.readFileSync(GRID_CSS, "utf8");
  expect(css).toMatch(/:where\(\[data-pretable-date-popover\]\)/);
  expect(css).toMatch(
    /:where\(\[data-pretable-date-day\]\[aria-selected="true"\]\)/,
  );
  expect(css).toMatch(
    /:where\(\[data-pretable-date-day\]\[data-pretable-date-today\]\)/,
  );
});
```

- [ ] **Step 2: Run, verify FAIL** — `pnpm --filter @pretable/ui test -- css-cascade`.

- [ ] **Step 3: Add the rules** — inside the single `@layer pretable { }` block in `packages/ui/src/grid.css`, next to the enum listbox rules. All `:where()`-wrapped, tokens only; the popover re-declares `font-family` because portaled content leaves the viewport subtree:

```css
/* Date calendar (cell editor) */
:where([data-pretable-date-editor]) {
  display: block;
  width: 100%;
  height: 100%;
}

:where([data-pretable-date-popover]) {
  padding: 8px;
  background: var(--pretable-bg-grid);
  border: 1px solid var(--pretable-rule-strong);
  border-radius: var(--pretable-radius);
  box-shadow: var(--pretable-reorder-ghost-shadow);
  font-family: var(--pretable-font-sans);
  font-size: var(--pretable-font-size-cell);
  color: var(--pretable-text-cell);
}

:where([data-pretable-date-header]) {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-weight: 600;
  padding-bottom: 6px;
}

:where([data-pretable-date-header] button) {
  border: none;
  background: none;
  color: var(--pretable-text-header);
  cursor: pointer;
  padding: 0 6px;
}

:where([data-pretable-date-header] button:hover) {
  color: var(--pretable-accent);
}

:where([data-pretable-date-popover] [role="row"]) {
  display: grid;
  grid-template-columns: repeat(7, 1fr);
}

:where([data-pretable-date-weekdays] [role="columnheader"]) {
  text-align: center;
  padding: 2px 0;
  color: var(--pretable-text-dim);
}

:where([data-pretable-date-day]) {
  text-align: center;
  padding: 4px 0;
  border-radius: var(--pretable-radius);
  cursor: pointer;
}

:where([data-pretable-date-day]:hover) {
  background: var(--pretable-bg-hover);
}

:where([data-pretable-date-day][data-pretable-date-outside]) {
  color: var(--pretable-text-dim);
}

:where([data-pretable-date-day][data-pretable-date-today]) {
  box-shadow: inset 0 0 0 1px var(--pretable-focus-ring);
}

:where([data-pretable-date-day][aria-selected="true"]) {
  background: var(--pretable-bg-selected);
  color: var(--pretable-text-selected);
}
```

- [ ] **Step 4: Run the ui suite, verify PASS** — `pnpm --filter @pretable/ui test` (the all-selectors-`:where()` contract must stay green).

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(ui): date calendar popover skin"
```

---

## Task 5: Docs

**Files:**

- Modify: `apps/website/content/docs/grid/editing.mdx`

- [ ] **Step 1: Update the typed-editors content** — change the `"date"` dispatch-table row from the text fallback to the calendar, and add a "Dates" subsection. Verify every claim against `DateCellEditor.tsx` / `date-utils.ts` / `type-parsing.ts` before writing. Cover: the field is strict `YYYY-MM-DD` (locale formats like `08/06/2026` are rejected with "Use YYYY-MM-DD", as is calendar overflow like `2026-02-30`); an empty field commits `null`; a `Date` or timestamp in the cell is re-seeded and committed as an ISO string (use `parseEditValue` if you need `Date` objects back); the popover shows a Monday-start month grid marking today and the selection; **arrow keys move the calendar (±1 day, ±7 for up/down) rather than the text caret**, PageUp/PageDown change month, the ‹ › buttons do the same; `Enter` commits the highlighted day and moves down, `Tab` commits and moves right, clicking a day commits in place, `Escape` cancels, and blur commits a valid date or reverts an invalid one. Note what's deliberately out: time-of-day, ranges, min/max, and configurable week start — `renderEditor` is the escape hatch. Also update the series note if the page says date "falls back to text".

- [ ] **Step 2: Format + build**

Run: `pnpm exec prettier --write apps/website/content/docs/grid/editing.mdx && pnpm --filter @pretable/app-website build`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "docs(website): date cell editor"
```

---

## Task 6: Full verification

- [ ] **Step 1:** `pnpm -r --filter './packages/*' test` → PASS
- [ ] **Step 2:** `pnpm typecheck` → PASS
- [ ] **Step 3:** `pnpm lint` → PASS
- [ ] **Step 4:** `pnpm format` → PASS (prettier-write anything flagged; fold into Step 8)
- [ ] **Step 5:** `pnpm api:check` → exit 0 (editors stay internal, so no public-surface change is expected)
- [ ] **Step 6:** `pnpm lint:packaging` → PASS
- [ ] **Step 7:** `pnpm --filter @pretable/app-website build` → PASS
- [ ] **Step 8:** `git add -A && git commit -m "chore: date calendar — verification fixups"` (only if fixups exist)

---

## Notes for the executor

- **Mirror `EnumCellEditor` closely** — it is the reviewed, shipped precedent for anchor measurement, portaling, the `mousedown` guard, the seed-normalisation effect, and the `commit()`-vs-`commit(direction)` call shape. Divergence needs a reason.
- **All date math is UTC** to match the engine's `toDayMs`. Never use local-time getters for value math; `todayIso()` is the one deliberate exception (today should mean the user's today).
- **The popover must never take focus.** `mousedown` is default-prevented, header buttons are `tabIndex={-1}`, and day cells are `<span role="gridcell">`, not buttons. If focus escapes to the popover, the shared chrome's blur-commit fires.
- Editors stay **internal** — nothing new in `public_api.ts`, so `api:check` should be unaffected.
- Prettier-format every file you touch; the repo's `format` gate is required and has tripped in previous sub-projects.
- Env gotchas: `pyenv: cannot rehash` noise is harmless; if a run fails with an esbuild error, relink `ESB=$(ls -d node_modules/.pnpm/esbuild@*/node_modules/esbuild | head -1); rm -rf node_modules/esbuild; ln -s "${ESB#node_modules/}" node_modules/esbuild`.
