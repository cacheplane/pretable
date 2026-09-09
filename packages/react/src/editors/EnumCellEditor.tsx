import {
  createElement,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import type { ColumnOption, PretableFocusDirection } from "@pretable/core";

import {
  EMPTY_RECT,
  Listbox,
  listboxOptionId,
  useListboxKeys,
} from "../components/listbox";
import { useOverlayContainer } from "../overlay/portal-context";
import type { PretableEditorInput } from "../types";
import { filterOptions, matchOption, optionLabel } from "./enum-options";
import { useEditorField } from "./use-editor-field";

/**
 * What the list shows: every option until the user has typed, the filtered
 * set after. One function because the mount seed and every render must agree
 * on it — a seed clamped against a different list than the one drawn puts the
 * highlight on the wrong row.
 */
function shownFor(
  options: readonly ColumnOption[],
  dirty: boolean,
  text: string,
): readonly ColumnOption[] {
  return dirty ? filterOptions(options, text) : options;
}

/**
 * The inert handlers. The list is always open — the field and its list mount
 * and unmount together — so nothing here opens or closes it; the outside
 * press that would close a select is answered by the input's own strict blur.
 * Module-level so the list's outside-press listener is not re-subscribed on
 * every keystroke (it is keyed on `onClose`).
 */
const NOOP = () => {};

/**
 * Strict enum combobox: the engine draft holds the input text, and commit maps
 * it to an option value (`parseDraftForType`). Free text that matches nothing
 * is rejected — `renderEditor` is the escape hatch for creatable comboboxes.
 *
 * The list and the arrow keys are the kit's `Listbox`/`useListboxKeys`; what
 * stays here is what makes this editor an editable combobox rather than a
 * select — the filtering input, the direction-aware commit, and the strict
 * blur that reverts unmatched text.
 */
export function EnumCellEditor({ input }: { input: PretableEditorInput }) {
  const { ref, pending, fieldProps } = useEditorField<HTMLInputElement>(input);
  const options = useMemo(
    () => input.column.options ?? [],
    [input.column.options],
  );
  const listId = useId();
  const overlayReady = useOverlayContainer() !== null;
  const anchorRef = useRef<HTMLSpanElement>(null);
  const [rect, setRect] = useState<DOMRect | null>(null);
  // The mount state, computed once and together because the highlight's seed
  // depends on whether the list starts filtered.
  //
  // `dirty`: until the user types, show every option — the seeded text is the
  // current value and would otherwise filter the list down to one. A seed
  // matching nothing is a type-to-replace character, so filter right away.
  //
  // `index`: the current value's row, clamped against the list actually
  // shown, because that row indexes the FULL option list. The hook owns the
  // arrow arithmetic and steps from its own state, so the clamp lives in the
  // seed instead of at each keypress, or the first press from a filtered
  // mount skips a row.
  const [initial] = useState(() => {
    const seeded = String(input.draft ?? "");
    const match = matchOption(options, seeded);
    const shown = shownFor(options, !match, seeded);
    const i = options.findIndex((o) => o.value === String(input.value ?? ""));
    const raw = i >= 0 ? i : 0;
    return { dirty: !match, index: raw < shown.length ? raw : 0 };
  });
  const [dirty, setDirty] = useState(initial.dirty);

  useLayoutEffect(() => {
    const measure = () => {
      if (anchorRef.current) setRect(anchorRef.current.getBoundingClientRect());
    };
    measure();
    // The listbox is portaled and `position: fixed`, so it detaches visually
    // when anything scrolls. Capture phase catches grid-internal scrollers,
    // which don't bubble.
    window.addEventListener("scroll", measure, true);
    window.addEventListener("resize", measure);
    return () => {
      window.removeEventListener("scroll", measure, true);
      window.removeEventListener("resize", measure);
    };
  }, []);

  const normalized = useRef(false);

  // The controller seeds the draft with the raw cell value; show the option's
  // label instead so the field reads the way the cell does. Wait for editing
  // permission, then normalize an untouched seed once for this mount.
  useLayoutEffect(() => {
    if (normalized.current || input.status !== "editing") return;
    normalized.current = true;
    const seeded = String(input.draft ?? "");
    const match = matchOption(options, seeded);
    if (match && optionLabel(match) !== seeded)
      input.setDraft(optionLabel(match));
  }, [input, options]);

  const text = String(input.draft ?? "");
  const visible = useMemo(
    () => shownFor(options, dirty, text),
    [options, dirty, text],
  );
  const listOptions = useMemo(
    () => visible.map((o) => ({ value: o.value, label: optionLabel(o) })),
    [visible],
  );

  const choose = (
    option: ColumnOption | undefined,
    direction?: PretableFocusDirection,
  ) => {
    if (!option || pending) return;
    // setDraft mutates engine state synchronously, so the commit that follows
    // reads the option we just wrote.
    input.setDraft(optionLabel(option));
    // No direction = commit in place (a click); don't pass an explicit
    // undefined, so the call matches the shared chrome's `commit()`.
    if (direction) input.commit(direction);
    else input.commit();
  };

  const keys = useListboxKeys({
    options: listOptions,
    // Always open: the field and its list mount and unmount together.
    open: true,
    // Read once, on mount: the hook re-seeds the highlight on an open EDGE,
    // and this list is always open.
    initialIndex: initial.index,
    onOpen: NOOP,
    onCommit: (value) =>
      choose(
        visible.find((o) => o.value === value),
        "down",
      ),
    onClose: NOOP,
  });

  // Belt and braces: the seed is already clamped and typing resets the
  // highlight to 0, but a render must never point at an option that is not
  // there.
  const index = Math.min(
    Math.max(keys.activeIndex, 0),
    Math.max(visible.length - 1, 0),
  );
  const active = visible[index];

  return (
    <span ref={anchorRef} data-pretable-enum-editor="">
      <input
        ref={ref}
        className="pretable-cell-editor"
        role="combobox"
        aria-expanded={overlayReady && visible.length > 0}
        aria-controls={overlayReady && visible.length > 0 ? listId : undefined}
        aria-autocomplete="list"
        aria-activedescendant={
          overlayReady && active ? listboxOptionId(listId, index) : undefined
        }
        value={text}
        onChange={(e) => {
          if (pending) return;
          // A correction supersedes the seed, including after permission errors.
          normalized.current = true;
          setDirty(true);
          keys.setActiveIndex(0);
          input.setDraft(e.target.value);
        }}
        {...fieldProps}
        onBlur={() => {
          // Strict: clicking away with unmatched text reverts rather than
          // leaving a rejected edit stuck open on the cell.
          if (input.status !== "editing") return;
          if (matchOption(options, text)) input.commit();
          else input.cancel();
        }}
        onKeyDown={(e) => {
          // Only the arrows go to the kit's keyboard; Home/End stay on the
          // caret (the editable-combobox pattern), printable keys filter —
          // the hook's typeahead would preventDefault the very characters the
          // field is there to receive.
          if (e.key === "ArrowDown" || e.key === "ArrowUp") {
            // Wrap and skip-disabled come from the hook now — the arithmetic
            // this editor used to spell out itself.
            if (pending) {
              e.preventDefault();
              e.stopPropagation();
            } else keys.onKeyDown(e);
            return;
          }
          if ((e.key === "Enter" || e.key === "Tab") && active) {
            e.preventDefault();
            e.stopPropagation();
            // The editor's own commit, not the hook's: it carries a DIRECTION
            // (Enter moves down, Tab right) that a list has no notion of.
            choose(active, e.key === "Enter" ? "down" : "right");
            return;
          }
          // No highlighted option (or Escape): let the shared chrome commit
          // the raw text — parseDraftForType rejects it — or cancel.
          fieldProps.onKeyDown(e);
        }}
      />
      <Listbox
        id={listId}
        // The cell editors' fixed column, not a menu's content width.
        width="dialog"
        options={listOptions}
        // For an editable combobox aria-selected follows the HIGHLIGHT (the
        // APG editable-combobox pattern), so the editor feeds the highlight
        // in as the value; there is no separately committed value while
        // editing.
        value={active ? active.value : null}
        activeIndex={index}
        anchor={rect ?? EMPTY_RECT}
        onSelect={(value) => choose(visible.find((o) => o.value === value))}
        // Outside press: the strict combobox reverts unmatched text, as its
        // onBlur does — the blur fires on its own.
        onClose={NOOP}
      />
    </span>
  );
}
