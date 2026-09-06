import { createElement, useId, useLayoutEffect, useRef, useState } from "react";

import type { ColumnOption, PretableFocusDirection } from "@pretable/core";

import {
  Listbox,
  listboxOptionId,
  useListboxKeys,
} from "../components/listbox";
import type { PretableEditorInput } from "../types";
import { filterOptions, matchOption, optionLabel } from "./enum-options";
import { useEditorField } from "./use-editor-field";

/**
 * The anchor before the layout effect has measured one. The list places
 * against it for that one frame instead of rendering unplaced.
 * SSR-safe: no `DOMRect` constructor exists on the server.
 */
const EMPTY_RECT: DOMRect =
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
  const options = input.column.options ?? [];
  const listId = useId();
  const anchorRef = useRef<HTMLSpanElement>(null);
  const [rect, setRect] = useState<DOMRect | null>(null);
  // The mount state, computed once and together because the highlight's seed
  // depends on whether the list starts filtered.
  //
  // `dirty`: until the user types, show every option (the seeded text is the
  // current value and would otherwise filter the list down to one). A seed
  // that matches nothing is a type-to-replace character, so filter right away.
  //
  // `index`: the current value's row — but clamped against the list actually
  // rendered, because that row indexes the FULL option list and a
  // type-to-replace seed renders already-filtered. The hook owns the arrow
  // arithmetic now and steps from its own state, so the clamp has to be in
  // the seed rather than applied at each keypress, or the first press from a
  // filtered mount skips a row.
  const [initial] = useState(() => {
    const seeded = String(input.draft ?? "");
    const match = matchOption(options, seeded);
    const shown = match ? options : filterOptions(options, seeded);
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

  // The controller seeds the draft with the raw cell value; show the option's
  // label instead so the field reads the way the cell does. One-shot: it only
  // fires when the seed matches an option whose label differs.
  useLayoutEffect(() => {
    const seeded = String(input.draft ?? "");
    const match = matchOption(options, seeded);
    if (match && optionLabel(match) !== seeded)
      input.setDraft(optionLabel(match));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const text = String(input.draft ?? "");
  const visible = dirty ? filterOptions(options, text) : options;
  const listOptions = visible.map((o) => ({
    value: o.value,
    label: optionLabel(o),
  }));

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
    onOpen: () => {},
    onCommit: (value) =>
      choose(
        visible.find((o) => o.value === value),
        "down",
      ),
    onClose: () => {},
  });

  // Belt and braces: the seed is already clamped and typing resets the
  // highlight to 0, but a render must never point at an option that is not
  // there.
  const index = keys.activeIndex < visible.length ? keys.activeIndex : 0;
  const active = visible[index];

  return (
    <span ref={anchorRef} data-pretable-enum-editor="">
      <input
        ref={ref}
        className="pretable-cell-editor"
        role="combobox"
        aria-expanded
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={
          active ? listboxOptionId(listId, index) : undefined
        }
        value={text}
        onChange={(e) => {
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
          // Only the navigation keys go to the kit's keyboard. NOT the
          // printable ones: this combobox filters by typing, and the hook's
          // typeahead would preventDefault the very characters the field is
          // there to receive.
          if (
            e.key === "ArrowDown" ||
            e.key === "ArrowUp" ||
            e.key === "Home" ||
            e.key === "End"
          ) {
            // Wrap, skip-disabled and Home/End come from the hook now — the
            // arithmetic this editor used to spell out itself.
            keys.onKeyDown(e);
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
        onClose={() => {
          // Outside press: the strict combobox reverts unmatched text, as its
          // onBlur does — the blur fires on its own.
        }}
        listProps={{ "data-pretable-enum-listbox": "" }}
      />
    </span>
  );
}
