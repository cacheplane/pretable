import type { KeyboardEvent, RefObject } from "react";
import { useEffect, useRef } from "react";

/**
 * The shared `role="menu"` behavior for the tool panel's popovers — one home
 * for the keyboard-and-dismissal contract every list-shaped menu owes, so it
 * cannot be hand-rolled per menu and drift (extracted from `ColumnPinMenu`,
 * now also serving `AddGroupMenu`):
 *
 * - The first ENABLED item takes focus on mount — a menu opened from a
 *   button owns the focus while it is up, and the "current" item may well be
 *   disabled and first.
 * - Outside-pointerdown closes WITHOUT focus return: the click is already
 *   moving focus somewhere the user chose, and yanking it back would fight
 *   that.
 * - Escape closes WITH focus return. `preventDefault`, NOT `stopPropagation`:
 *   the tool pane's own Escape handler (which yanks focus to the rail tab)
 *   skips events that are defaultPrevented — that check is the designed
 *   interlock, and a portal still bubbles through the React tree to it.
 * - ArrowUp/ArrowDown rove focus across the enabled items, wrapping.
 *
 * A TOGGLING anchor must `stopPropagation()` on its own pointerdown, or the
 * outside-press close and the toggle fight — the document listener closes
 * the menu first and the anchor's click reopens it, so the button could
 * never dismiss its own menu. Both current callers do this on the button;
 * this bullet is the contract's home.
 *
 * Items are discovered by the popover contract's own attribute
 * (`[data-pretable-menu-item]`), queried live so a menu whose items change
 * while open needs no bookkeeping. The header's `ColumnMenu` is deliberately
 * NOT a consumer: it renders exactly one item (no roving) and its Escape
 * must `stopPropagation` — different semantics, not a missed extraction.
 *
 * Focus RETURN is the caller's job, via `onClose(restoreFocus)`: only the
 * caller knows whether its anchor survives the close (the pin menu's kebab
 * can remount across subgroup fragments; the add-group button never moves).
 */
export function useMenuKeyboard(onClose: (restoreFocus: boolean) => void): {
  rootRef: RefObject<HTMLDivElement | null>;
  onKeyDown: (event: KeyboardEvent<HTMLDivElement>) => void;
} {
  const rootRef = useRef<HTMLDivElement>(null);

  const enabledItems = () =>
    Array.from(
      rootRef.current?.querySelectorAll<HTMLButtonElement>(
        "[data-pretable-menu-item]:not(:disabled)",
      ) ?? [],
    );

  // Mount-only on purpose: focus is taken when the menu OPENS, never again.
  useEffect(() => {
    enabledItems()[0]?.focus();
  }, []);

  useEffect(() => {
    const onPointerDown = (e: PointerEvent) => {
      const root = rootRef.current;
      if (root && e.target instanceof Node && !root.contains(e.target)) {
        onClose(false);
      }
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [onClose]);

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape" || event.key === "Esc") {
      event.preventDefault();
      onClose(true);
      return;
    }
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    event.preventDefault();
    const items = enabledItems();
    if (items.length === 0) return;
    const index = items.indexOf(document.activeElement as HTMLButtonElement);
    const delta = event.key === "ArrowDown" ? 1 : -1;
    items[(index + delta + items.length) % items.length]?.focus();
  };

  return { rootRef, onKeyDown };
}
