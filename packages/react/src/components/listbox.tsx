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

import { menuPopoverStyle } from "../overlay/popover-position";
import { OverlayPortal } from "../overlay/OverlayPortal";

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
  "aria-label"?: string;
  onSelect: (value: string) => void;
  /** Outside pointerdown. No focus return: the press chose a new target. */
  onClose: () => void;
  /** Extra attributes for the `<ul>` — a site's own `data-pretable-*`. */
  listProps?: Record<`data-${string}`, string>;
}

export function Listbox({
  id,
  options,
  value,
  activeIndex,
  anchor,
  "aria-label": ariaLabel,
  onSelect,
  onClose,
  listProps,
}: ListboxProps): ReactElement | null {
  const rootRef = useRef<HTMLUListElement>(null);

  useEffect(() => {
    const onPointerDown = (e: PointerEvent) => {
      const root = rootRef.current;
      if (root && e.target instanceof Node && !root.contains(e.target))
        onClose();
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [onClose]);

  useEffect(() => {
    if (activeIndex < 0) return;
    rootRef.current
      ?.querySelector<HTMLElement>(`[id="${id}-${activeIndex}"]`)
      ?.scrollIntoView?.({ block: "nearest" });
  }, [id, activeIndex]);

  // An empty list is not a list: no bare box (the enum editor's rule).
  if (options.length === 0) return null;

  return (
    <OverlayPortal>
      <ul
        {...listProps}
        ref={rootRef}
        id={id}
        role="listbox"
        aria-label={ariaLabel}
        data-pretable-listbox=""
        style={menuPopoverStyle(anchor)}
        // Keep focus on the trigger: a blur before the click lands would
        // close (or, in the editor, commit) under the pointer.
        onMouseDown={(e) => e.preventDefault()}
      >
        {options.map((option, i) => (
          <li
            key={option.value}
            id={`${id}-${i}`}
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

/** The next enabled index from `from` in `dir`, wrapping; `from` if none. */
function step(
  options: readonly ListboxOption[],
  from: number,
  dir: 1 | -1,
): number {
  const n = options.length;
  for (let k = 1; k <= n; k++) {
    const i = (from + dir * k + n) % n;
    if (!options[i]?.disabled) return i;
  }
  return from;
}

function edge(options: readonly ListboxOption[], dir: 1 | -1): number {
  const n = options.length;
  for (let k = 0; k < n; k++) {
    const i = dir === 1 ? k : n - 1 - k;
    if (!options[i]?.disabled) return i;
  }
  return -1;
}

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
        setActiveIndex((i) =>
          step(options, i < 0 ? -1 : i, key === "ArrowDown" ? 1 : -1),
        );
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
