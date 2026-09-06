/**
 * A select-only combobox: the kit's answer to the native <select>, whose open
 * list no theme can reach. The trigger is a button carrying
 * `role="combobox"`; the list is the kit's `Listbox`, portalled and placed
 * against the trigger. Both halves are styled by grid.css through
 * `data-pretable-select` (trigger) and `data-pretable-listbox` /
 * `data-pretable-option` (list), and a site's own attribute still arrives on
 * the trigger through the spread.
 *
 * `data-pretable-value` is written for one reason: a button has no `.value`,
 * and every test that used to read one reads this instead.
 */
import {
  createElement,
  forwardRef,
  useCallback,
  useId,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type ReactElement,
} from "react";

import { warnOnce } from "../dev-warn";
import { ChevronDownIcon } from "../icons";
import type { PretableButtonSite } from "./button";
import {
  EMPTY_RECT,
  Listbox,
  listboxOptionId,
  useListboxKeys,
  type ListboxOption,
} from "./listbox";

/**
 * One entry in a {@link PretableSelect}. A `disabled` option is shown, skipped
 * by the keyboard, and inert to click — how the aggregate picker shows a
 * consumer-written custom aggregate it must never write back.
 *
 * @public
 */
export type PretableSelectOption = ListboxOption;

/**
 * Props for {@link PretableSelect}.
 *
 * @public
 */
export interface PretableSelectProps extends Omit<
  ButtonHTMLAttributes<HTMLButtonElement>,
  "type" | "value" | "onChange" | "aria-label"
> {
  options: readonly PretableSelectOption[];
  /** The committed value. Absent from `options`, it renders as its own label. */
  value: string;
  onChange: (value: string) => void;
  /**
   * Required. A picker with no accessible name is the icon-button problem
   * again. An empty string warns in development.
   */
  "aria-label": string;
  /** Where in the grid this picker is; lands as `data-pretable-site`. */
  site?: PretableButtonSite;
}

/**
 * A select-only combobox in the grid's own chrome.
 *
 * ```tsx
 * <PretableSelect
 *   aria-label="Filter operator"
 *   options={operators.map((op) => ({ value: op, label: OPERATOR_LABELS[op] }))}
 *   value={draft.operator}
 *   onChange={(op) => setOperator(op as FilterOperator)}
 * />
 * ```
 *
 * @public
 */
export const PretableSelect = forwardRef<
  HTMLButtonElement,
  PretableSelectProps
>(function PretableSelect(
  {
    options,
    value,
    onChange,
    "aria-label": ariaLabel,
    site,
    disabled,
    onClick,
    onKeyDown,
    onPointerDown,
    ...buttonProps
  },
  ref,
): ReactElement {
  if ((ariaLabel ?? "").trim() === "") {
    warnOnce(
      "select-empty-name",
      "[pretable] <PretableSelect> rendered with an empty aria-label. A " +
        "picker with no accessible name reads as an unnamed button to a " +
        "screen reader. Name what it chooses, e.g. `Filter operator`.",
    );
  }

  const listId = useId();
  const triggerRef = useRef<HTMLButtonElement>(null);
  useImperativeHandle(ref, () => triggerRef.current as HTMLButtonElement);
  const [open, setOpen] = useState(false);
  const [rect, setRect] = useState<DOMRect>(EMPTY_RECT);

  const selectedIndex = options.findIndex((o) => o.value === value);
  const selected = options[selectedIndex];

  const close = useCallback((why: { restoreFocus: boolean }) => {
    setOpen(false);
    if (why.restoreFocus) triggerRef.current?.focus({ preventScroll: true });
  }, []);
  // The list's own dismissal: the press chose a new target, so focus stays
  // where the pointer put it. A `useCallback`, not an inline arrow — the
  // outside-press listener is keyed on this identity and would otherwise
  // re-subscribe on every render.
  const closeFromOutside = useCallback(() => {
    close({ restoreFocus: false });
  }, [close]);
  const commit = useCallback(
    (next: string) => {
      if (next !== value) onChange(next);
      close({ restoreFocus: true });
    },
    [value, onChange, close],
  );
  const openList = useCallback(() => {
    if (disabled) return;
    if (triggerRef.current) setRect(triggerRef.current.getBoundingClientRect());
    setOpen(true);
  }, [disabled]);

  const keys = useListboxKeys({
    options,
    open,
    initialIndex: selectedIndex >= 0 ? selectedIndex : 0,
    onOpen: openList,
    onCommit: commit,
    onClose: close,
  });

  // The list is `position: fixed` in a portal: re-anchor when anything
  // scrolls or resizes while it is open (capture catches the grid's own
  // scrollers, which do not bubble).
  useLayoutEffect(() => {
    if (!open) return;
    const measure = () => {
      if (triggerRef.current) {
        setRect(triggerRef.current.getBoundingClientRect());
      }
    };
    window.addEventListener("scroll", measure, true);
    window.addEventListener("resize", measure);
    return () => {
      window.removeEventListener("scroll", measure, true);
      window.removeEventListener("resize", measure);
    };
  }, [open]);

  return (
    <>
      <button
        {...buttonProps}
        ref={triggerRef}
        type="button"
        role="combobox"
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-activedescendant={
          open && keys.activeIndex >= 0
            ? listboxOptionId(listId, keys.activeIndex)
            : undefined
        }
        disabled={disabled}
        data-pretable-select=""
        data-pretable-site={site}
        data-pretable-value={value}
        onPointerDown={(e) => {
          onPointerDown?.(e);
          // The toggling-anchor contract (see listbox.tsx): the document's
          // outside-press listener must not see this press, or it closes the
          // list that the click then reopens.
          e.stopPropagation();
        }}
        onClick={(e) => {
          onClick?.(e);
          if (e.defaultPrevented) return;
          if (open) close({ restoreFocus: true });
          else openList();
        }}
        onKeyDown={(e) => {
          onKeyDown?.(e);
          if (e.defaultPrevented) return;
          keys.onKeyDown(e);
        }}
      >
        <span data-pretable-select-label="">
          {selected ? selected.label : value}
        </span>
        <ChevronDownIcon />
      </button>
      {open ? (
        <Listbox
          id={listId}
          options={options}
          value={value}
          activeIndex={keys.activeIndex}
          anchor={rect}
          onSelect={commit}
          onClose={closeFromOutside}
        />
      ) : null}
    </>
  );
});
