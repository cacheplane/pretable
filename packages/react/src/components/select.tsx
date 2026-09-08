/**
 * A select-only combobox: the kit's answer to the native <select>, whose open
 * list no theme can reach. The trigger is a button carrying
 * `role="combobox"`; the list is the kit's `Listbox`, portalled and placed
 * against the trigger. Both halves are styled by grid.css through
 * `data-pretable-select` (trigger), `data-pretable-select-label` (the label
 * span) and `data-pretable-listbox` / `data-pretable-option` (list), and a
 * site's own attribute still arrives on the trigger through the spread.
 *
 * `data-pretable-value` is written for one reason: a button has no `.value`,
 * and every test that used to read one reads this instead. It is the ONE
 * COMMITTED value — deliberately not the name the options wear, which is
 * `data-pretable-option-value` and says which option an element IS.
 */
import {
  createElement,
  Fragment,
  forwardRef,
  useCallback,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type ReactElement,
  type ReactNode,
} from "react";

import { warnOnce } from "../dev-warn";
import { ChevronDownIcon } from "../icons";
import type { PretableSite } from "./button";
import {
  EMPTY_RECT,
  firstEnabledIndex,
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
export interface PretableSelectOption {
  /** The string handed back to `onChange` and written to `data-pretable-value`. */
  readonly value: string;
  /** What the option shows, and what the trigger shows once it is chosen. */
  readonly label: ReactNode;
  /** Shown, skipped by the keyboard, inert to click. */
  readonly disabled?: boolean;
}

/**
 * Type identity, not two-way assignability: an OPTIONAL field added to one
 * side is assignable to the other and would slip through a pair of
 * assignments. The conditional-signature trick compares the types themselves.
 */
type Equal<TLeft, TRight> =
  (<T>() => T extends TLeft ? 1 : 2) extends <T>() => T extends TRight ? 1 : 2
    ? true
    : false;

// The public option shape IS the list's option shape. Pinned, because a
// divergence in the internal `ListboxOption` would otherwise leave
// `PretableSelectOption` quietly describing something consumers do not get.
// A `false` here is a compile error at this line ("Type 'true' is not
// assignable to type 'false'") — it does not name the field that drifted.
// Diff `PretableSelectOption` against `ListboxOption` by hand to find it.
const _optionShapePin: Equal<PretableSelectOption, ListboxOption> = true;
void _optionShapePin;

/**
 * Props for {@link PretableSelect}.
 *
 * @public
 */
export interface PretableSelectProps extends Omit<
  ButtonHTMLAttributes<HTMLButtonElement>,
  "type" | "value" | "onChange" | "aria-label" | "children"
> {
  /** The choices, in display order. */
  options: readonly PretableSelectOption[];
  /** The committed value. Absent from `options`, it renders as its own label. */
  value: string;
  /** Called with the chosen value, and only when it differs from `value`. */
  onChange: (value: string) => void;
  /**
   * Required. A picker with no accessible name is the icon-button problem
   * again. An empty string warns once per page.
   */
  "aria-label": string;
  /** Where in the grid this picker is; lands as `data-pretable-site`. */
  site?: PretableSite;
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
  // A merged callback ref: the component needs the node (to measure and to
  // restore focus) and the consumer still gets whichever ref form it passed.
  const setTriggerRef = useCallback(
    (node: HTMLButtonElement | null) => {
      triggerRef.current = node;
      if (typeof ref === "function") ref(node);
      else if (ref) ref.current = node;
    },
    [ref],
  );
  const [open, setOpen] = useState(false);
  const [rect, setRect] = useState<DOMRect>(EMPTY_RECT);

  // Disabled mid-open: nothing else can close the list, and a disabled button
  // receives no keydown, so Escape goes with it. Adjusting state during
  // render, the React-sanctioned form.
  if (disabled && open) setOpen(false);

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
    // Nothing to choose. Opening on an empty roster would leave the trigger
    // claiming `aria-expanded="true"` with `aria-controls` pointing at a list
    // that renders nothing — a screen reader is told a list opened and finds
    // no list. The keyboard path lands here too: `useListboxKeys` opens a
    // closed trigger through `onOpen`, which is this.
    if (options.length === 0) return;
    if (triggerRef.current) setRect(triggerRef.current.getBoundingClientRect());
    setOpen(true);
  }, [disabled, options.length]);

  const keys = useListboxKeys({
    options,
    open,
    initialIndex:
      selectedIndex >= 0 ? selectedIndex : firstEnabledIndex(options),
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
        // WebKit's sequential focus navigation omits a plain <button> unless
        // macOS's "Tab moves between all controls" is on. The four pickers
        // this replaced were native <select>s — a Tab stop in every browser —
        // so an explicit tabindex is what keeps that parity. The tool panel's
        // rail tab carries one for the same reason. BEFORE the spread on
        // purpose: a consumer passing its own `tabIndex` (a roving `-1`, say)
        // still wins.
        tabIndex={0}
        {...buttonProps}
        ref={setTriggerRef}
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
      {open && !disabled ? (
        <Listbox
          id={listId}
          aria-label={ariaLabel}
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
