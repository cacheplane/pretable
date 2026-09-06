/**
 * The kit's one list: what a select-only combobox and the enum cell editor
 * both pop open. Two pieces with two responsibilities, so each trigger keeps
 * its own shape:
 *
 * - `Listbox` RENDERS the portalled `role="listbox"` from data the trigger
 *   owns — the ARIA markup lives here and nowhere else.
 * - `useListboxKeys` is the trigger's KEYBOARD: arrows/Home/End with wrap and
 *   disabled-skip, typeahead, Enter/Space to commit, Escape/Tab to close, and
 *   the navigation keys opening a closed trigger — the native <select>
 *   contract a keyboard user expects.
 *
 * Portalled for the standing reason: the grid viewport's `contain: content`
 * would clip a fixed popover. Placed by `menuPopoverStyle`, so a list clamps
 * against the viewport exactly as the menus do.
 *
 * A TOGGLING trigger — one whose click both opens and closes the list — must
 * `stopPropagation()` on its own pointerdown, or the outside-press listener
 * below closes what the click then reopens, and the trigger could never
 * dismiss its own list. Same contract `menu-keyboard.ts` states for menus.
 */
import {
  createElement,
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactElement,
  type ReactNode,
} from "react";

import { menuPopoverStyle, popoverStyle } from "../overlay/popover-position";
import { OverlayPortal } from "../overlay/OverlayPortal";

/**
 * The id of one option, from the list's own id and the option's index. One
 * helper because three places must agree on the format: the `<li id>`, the
 * reveal effect's query, and a trigger's `aria-activedescendant`.
 */
// eslint-disable-next-line react-refresh/only-export-components -- the list, its id format and its trigger keyboard are one unit
export function listboxOptionId(id: string, index: number): string {
  return `${id}-${index}`;
}

/**
 * The anchor a trigger places its list against before the layout effect has
 * measured one. The list draws against it for that one frame instead of
 * rendering unplaced. SSR-safe: no `DOMRect` constructor exists on the server.
 *
 * Here rather than at each trigger because every trigger of this list needs
 * exactly the same placeholder.
 */
// eslint-disable-next-line react-refresh/only-export-components -- the list and its triggers' shared anchor placeholder are one unit
export const EMPTY_RECT: DOMRect =
  typeof DOMRect === "undefined"
    ? ({
        top: 0,
        left: 0,
        bottom: 0,
        right: 0,
        width: 0,
        height: 0,
        x: 0,
        y: 0,
        toJSON: () => ({}),
      } as DOMRect)
    : new DOMRect(0, 0, 0, 0);

/** One entry in a list. `disabled` is skipped by the keyboard and inert to click. */
export interface ListboxOption {
  readonly value: string;
  readonly label: ReactNode;
  readonly disabled?: boolean;
}

/** How long two keystrokes stay one typeahead query. The native control's feel. */
const TYPEAHEAD_RESET_MS = 500;

/** Text for typeahead: a string label as is, a node by its rendered text. */
function labelText(label: ReactNode): string {
  if (typeof label === "string") return label;
  if (typeof label === "number") return String(label);
  return "";
}

export interface ListboxProps {
  /** The trigger's `aria-controls` target; option ids are `${id}-${index}`. */
  id: string;
  options: readonly ListboxOption[];
  /** The committed value — `aria-selected` — or null. */
  value: string | null;
  /** The roving highlight; -1 for none. Owned by the trigger via the hook. */
  activeIndex: number;
  /** The trigger's rect; the list is placed against it. */
  anchor: DOMRect;
  /**
   * How wide the list draws: the cell editors' list is the DIALOG width, the
   * fixed 240px column their panels use, so the list lines up with the field
   * it drops from; a select's list sizes to its CONTENT, as the menus do.
   * See `popover-position.ts` for both.
   */
  width?: "content" | "dialog";
  "aria-label"?: string;
  onSelect: (value: string) => void;
  /** Outside pointerdown. No focus return: the press chose a new target. */
  onClose: () => void;
}

export function Listbox({
  id,
  options,
  value,
  activeIndex,
  anchor,
  width = "content",
  "aria-label": ariaLabel,
  onSelect,
  onClose,
}: ListboxProps): ReactElement | null {
  const rootRef = useRef<HTMLUListElement>(null);

  useEffect(() => {
    const onPointerDown = (e: PointerEvent) => {
      const root = rootRef.current;
      // A null root is OUTSIDE, not "no answer": the empty list renders
      // nothing (below) while these hooks still run, and a guard that
      // required a root would swallow the only press that can close it.
      if (e.target instanceof Node && !root?.contains(e.target)) onClose();
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [onClose]);

  // `options` is a dependency, not noise: filtering the list changes WHICH
  // option sits at `activeIndex` without changing the index itself.
  useEffect(() => {
    if (activeIndex < 0) return;
    rootRef.current
      ?.querySelector<HTMLElement>(`[id="${listboxOptionId(id, activeIndex)}"]`)
      // Optional call for jsdom, which implements no scrollIntoView at all;
      // every real DOM has one.
      ?.scrollIntoView?.({ block: "nearest" });
  }, [id, activeIndex, options]);

  // An empty list is not a list: no bare box (the enum editor's rule).
  if (options.length === 0) return null;

  return (
    <OverlayPortal>
      <ul
        ref={rootRef}
        id={id}
        role="listbox"
        aria-label={ariaLabel}
        data-pretable-listbox=""
        style={
          width === "dialog" ? popoverStyle(anchor) : menuPopoverStyle(anchor)
        }
        // Keep focus on the trigger: a blur before the click lands would
        // close (or, in the editor, commit) under the pointer.
        onMouseDown={(e) => e.preventDefault()}
        // The list is portalled to body, so every host popover's own
        // outside-press listener (the filter menu's, a dialog's) would read a
        // press INSIDE this list as outside and dismiss itself under the
        // pointer. Stopping it here is the mirror of the toggling trigger's
        // own stopPropagation. This list's dismissal is unaffected: its
        // listener tests containment, so the press it must not see is exactly
        // the one it no longer receives, and an outside press still arrives.
        onPointerDown={(e) => e.stopPropagation()}
      >
        {options.map((option, i) => (
          <li
            key={option.value}
            id={listboxOptionId(id, i)}
            role="option"
            aria-selected={option.value === value}
            aria-disabled={option.disabled ? true : undefined}
            data-pretable-option=""
            data-value={option.value}
            data-active={i === activeIndex ? "" : undefined}
            onClick={() => {
              if (!option.disabled) onSelect(option.value);
            }}
          >
            {option.label}
          </li>
        ))}
      </ul>
    </OverlayPortal>
  );
}

export interface UseListboxKeysInput {
  options: readonly ListboxOption[];
  /** Whether the list is showing. Closed, the navigation keys OPEN. */
  open: boolean;
  /** Where the highlight starts when the list opens (the current value). */
  initialIndex: number;
  onOpen: () => void;
  onCommit: (value: string) => void;
  onClose: (why: { restoreFocus: boolean }) => void;
}

export interface UseListboxKeysResult {
  activeIndex: number;
  setActiveIndex: (index: number) => void;
  onKeyDown: (event: KeyboardEvent) => void;
}

/**
 * The next enabled index from `from` in `dir`, wrapping; `from` if there is
 * none — so with EVERY option disabled the highlight stays where it is and
 * Enter commits nothing.
 *
 * "No highlight" (`from < 0`) is normalised to the position just OUTSIDE the
 * end the walk starts from, which is what makes the first ArrowUp land on the
 * last enabled option rather than the second-to-last, as `<select>` does.
 * Note the `from` (not `start`) return: the no-match answer is still -1.
 */
function step(
  options: readonly ListboxOption[],
  from: number,
  dir: 1 | -1,
): number {
  const n = options.length;
  const start = from < 0 ? (dir === 1 ? -1 : n) : from;
  for (let k = 1; k <= n; k++) {
    const i = (((start + dir * k) % n) + n) % n;
    if (!options[i]?.disabled) return i;
  }
  return from;
}

/**
 * The first enabled index from the `dir` end — Home (`1`) and End (`-1`).
 * `-1` when every option is disabled: there is no option to highlight, and
 * -1 is the list's own "no highlight".
 */
function edge(options: readonly ListboxOption[], dir: 1 | -1): number {
  const n = options.length;
  for (let k = 0; k < n; k++) {
    const i = dir === 1 ? k : n - 1 - k;
    if (!options[i]?.disabled) return i;
  }
  return -1;
}

/**
 * The first option a trigger can highlight — where the roving highlight starts
 * when the committed value is not in the list at all. `-1` when every option
 * is disabled, the list's own "no highlight".
 */
// eslint-disable-next-line react-refresh/only-export-components -- the list and its triggers' shared seeding rule are one unit
export function firstEnabledIndex(options: readonly ListboxOption[]): number {
  return edge(options, 1);
}

// eslint-disable-next-line react-refresh/only-export-components -- the list and its trigger keyboard are one unit
export function useListboxKeys({
  options,
  open,
  initialIndex,
  onOpen,
  onCommit,
  onClose,
}: UseListboxKeysInput): UseListboxKeysResult {
  const [activeIndex, setActiveIndex] = useState(initialIndex);

  // Re-seed the highlight from the value each time the list opens —
  // adjusting state during render, the React-sanctioned form; an effect
  // would commit one frame of stale highlight and trips the
  // set-state-in-effect rule.
  const [prevOpen, setPrevOpen] = useState(open);
  if (open !== prevOpen) {
    setPrevOpen(open);
    if (open) setActiveIndex(initialIndex);
  }

  const buffer = useRef("");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const onKeyDown = useCallback(
    (e: KeyboardEvent) => {
      const { key } = e;
      if (!open) {
        if (
          key === "ArrowDown" ||
          key === "ArrowUp" ||
          key === "Enter" ||
          key === " "
        ) {
          e.preventDefault();
          onOpen();
        }
        return;
      }
      if (key === "ArrowDown" || key === "ArrowUp") {
        e.preventDefault();
        e.stopPropagation();
        setActiveIndex((i) => step(options, i, key === "ArrowDown" ? 1 : -1));
        return;
      }
      if (key === "Home" || key === "End") {
        e.preventDefault();
        setActiveIndex(edge(options, key === "Home" ? 1 : -1));
        return;
      }
      if (key === "Enter" || key === " ") {
        e.preventDefault();
        e.stopPropagation();
        const option = options[activeIndex];
        if (option && !option.disabled) onCommit(option.value);
        return;
      }
      if (key === "Escape" || key === "Esc") {
        e.preventDefault();
        // `stopPropagation` too, unlike the menus: a select's Escape closes
        // the LIST and leaves focus on the trigger, so the tool pane must not
        // also read it and punt focus to the rail tab. That is the header's
        // `ColumnMenu` exception in `menu-keyboard.ts`, for the same reason —
        // one popover, one dismissal, the anchor keeps the focus.
        e.stopPropagation();
        onClose({ restoreFocus: true });
        return;
      }
      if (key === "Tab") {
        onClose({ restoreFocus: false });
        return;
      }
      // Typeahead: one printable character at a time, accumulated for
      // TYPEAHEAD_RESET_MS, matched against the labels' prefixes from the top.
      if (key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
        e.preventDefault();
        buffer.current += key.toLowerCase();
        if (timer.current) clearTimeout(timer.current);
        timer.current = setTimeout(() => {
          buffer.current = "";
        }, TYPEAHEAD_RESET_MS);
        const query = buffer.current;
        const hit = options.findIndex(
          (o) =>
            !o.disabled && labelText(o.label).toLowerCase().startsWith(query),
        );
        if (hit >= 0) setActiveIndex(hit);
      }
    },
    [open, options, activeIndex, onOpen, onCommit, onClose],
  );

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  return { activeIndex, setActiveIndex, onKeyDown };
}
