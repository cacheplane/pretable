import { createElement, useId, useLayoutEffect, useRef, useState } from "react";

import type { ColumnOption, PretableFocusDirection } from "@pretable/core";

import { OverlayPortal } from "../overlay/OverlayPortal";
import { popoverStyle } from "../overlay/popover-position";
import type { PretableEditorInput } from "../types";
import { filterOptions, matchOption, optionLabel } from "./enum-options";
import { useEditorField } from "./use-editor-field";

/**
 * Strict enum combobox: the engine draft holds the input text, and commit maps
 * it to an option value (`parseDraftForType`). Free text that matches nothing
 * is rejected — `renderEditor` is the escape hatch for creatable comboboxes.
 */
export function EnumCellEditor({ input }: { input: PretableEditorInput }) {
  const { ref, pending, fieldProps } = useEditorField<HTMLInputElement>(input);
  const options = input.column.options ?? [];
  const listId = useId();
  const anchorRef = useRef<HTMLSpanElement>(null);
  const [rect, setRect] = useState<DOMRect | null>(null);
  // Until the user types, show every option (the seeded text is the current
  // value and would otherwise filter the list down to one). A seed that
  // matches nothing is a type-to-replace character, so filter right away.
  const [dirty, setDirty] = useState(
    () => !matchOption(options, String(input.draft ?? "")),
  );
  const [highlight, setHighlight] = useState(() => {
    const i = options.findIndex((o) => o.value === String(input.value ?? ""));
    return i >= 0 ? i : 0;
  });

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
  // `highlight` indexes the full option list on mount, and a type-to-replace
  // seed renders already-filtered — so clamp at render rather than trusting
  // an onChange to have reset it.
  const index = highlight < visible.length ? highlight : 0;
  const active = visible[index];

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

  return (
    <span ref={anchorRef} data-pretable-enum-editor="">
      <input
        ref={ref}
        className="pretable-cell-editor"
        role="combobox"
        aria-expanded
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={active ? `${listId}-${index}` : undefined}
        value={text}
        onChange={(e) => {
          setDirty(true);
          setHighlight(0);
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
          if (e.key === "ArrowDown" || e.key === "ArrowUp") {
            e.preventDefault();
            e.stopPropagation();
            const n = visible.length;
            if (n > 0) {
              setHighlight((h) => {
                // Step from the value the render clamped to, not the stale raw
                // one, or the first press from a clamped mount skips a row.
                const from = h < n ? h : 0;
                return e.key === "ArrowDown"
                  ? (from + 1) % n
                  : (from - 1 + n) % n;
              });
            }
            return;
          }
          if ((e.key === "Enter" || e.key === "Tab") && active) {
            e.preventDefault();
            e.stopPropagation();
            choose(active, e.key === "Enter" ? "down" : "right");
            return;
          }
          // No highlighted option (or Escape): let the shared chrome commit
          // the raw text — parseDraftForType rejects it — or cancel.
          fieldProps.onKeyDown(e);
        }}
      />
      <OverlayPortal>
        <ul
          id={listId}
          role="listbox"
          data-pretable-enum-listbox=""
          style={rect ? popoverStyle(rect) : undefined}
          // Keep focus in the input; a blur would commit or revert before the
          // click lands (same hazard as the number steppers).
          onMouseDown={(e) => e.preventDefault()}
        >
          {visible.map((option, i) => (
            <li
              key={option.value}
              id={`${listId}-${i}`}
              role="option"
              aria-selected={i === index}
              data-pretable-enum-option=""
              onClick={() => choose(option)}
            >
              {optionLabel(option)}
            </li>
          ))}
        </ul>
      </OverlayPortal>
    </span>
  );
}
