/**
 * A select-only combobox: the kit's answer to the native <select>, whose open
 * list no theme can reach. The trigger is a button carrying
 * `role="combobox"`; the list is the kit's `Listbox`, portalled and placed
 * against the trigger. Both halves are styled by grid.css through
 * `data-pretable-select` (trigger), `data-pretable-select-label` (the label
 * span) and `data-pretable-listbox` / `data-pretable-option` (list), and a
 * site's own attribute still arrives on the trigger through the spread.
 *
 * `data-pretable-value` exposes the committed option value independently of
 * the native button's `.value`. Options use `data-pretable-option-value` to
 * identify themselves; the trigger carries only the committed selection.
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

import { observeAnchor } from "../overlay/observe-anchor";
import { useOverlayContainer } from "../overlay/portal-context";
import { warnOnce } from "../dev-warn";
import { ChevronDownIcon } from "../icons";
import type { PretableSite } from "./button";
import { useComposedRefs } from "./compose-refs";
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
export type PretableSelectOption = {
  /** Stable unique identity, passed to `onChange` and `data-pretable-value`. */
  readonly value: string;
  /** Shown, skipped by the keyboard, inert to click. */
  readonly disabled?: boolean;
} & (
  | {
      /** What the option and selected trigger show. */
      readonly label: string | number;
      /** Optional typeahead text; otherwise inferred from the label. */
      readonly textValue?: string;
    }
  | {
      /** Rich content shown in the option and selected trigger. */
      readonly label: Exclude<ReactNode, string | number>;
      /** Required typeahead text for a non-primitive label. */
      readonly textValue: string;
    }
);

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
  const setTriggerRef = useComposedRefs(triggerRef, ref);
  const [open, setOpen] = useState(false);
  const container = useOverlayContainer();
  const visible = open && container !== null;
  const [rect, setRect] = useState<DOMRect>(EMPTY_RECT);

  // Close synchronously if the trigger becomes disabled or its roster empties:
  // a disabled button cannot dismiss with Escape, and an empty Listbox has no
  // DOM target for the trigger's ARIA references.
  if (open && (disabled || options.length === 0)) setOpen(false);

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
  const measure = useCallback(() => {
    const next = triggerRef.current?.getBoundingClientRect();
    if (!next) return;
    setRect((previous) =>
      previous.left === next.left &&
      previous.top === next.top &&
      previous.width === next.width &&
      previous.height === next.height
        ? previous
        : next,
    );
  }, []);
  const openList = useCallback(() => {
    if (disabled) return;
    // Nothing to choose. Opening on an empty roster would leave the trigger
    // claiming `aria-expanded="true"` with `aria-controls` pointing at a list
    // that renders nothing — a screen reader is told a list opened and finds
    // no list. The keyboard path lands here too: `useListboxKeys` opens a
    // closed trigger through `onOpen`, which is this.
    if (options.length === 0) return;
    measure();
    setOpen(true);
  }, [disabled, options.length, measure]);

  const keys = useListboxKeys({
    options,
    open,
    initialIndex:
      selectedIndex >= 0 && !selected?.disabled
        ? selectedIndex
        : firstEnabledIndex(options),
    onOpen: openList,
    onCommit: commit,
    onClose: close,
  });

  // React layout changes and delayed portal attachment can move the trigger
  // without a scroll/resize event. Equal bounds retain state, so measuring
  // after each visible render cannot create a render loop.
  useLayoutEffect(() => {
    if (visible) measure();
  });

  // While visible, also follow CSS changes made outside React. Observe only
  // the trigger's ancestor chain, rather than polling or watching the entire
  // document subtree; scope direction, classes and tokens can all move it.
  useLayoutEffect(() => {
    const trigger = triggerRef.current;
    if (!visible || !trigger) return;
    return observeAnchor(trigger, measure);
  }, [visible, measure]);

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
        aria-expanded={visible}
        aria-controls={visible ? listId : undefined}
        aria-activedescendant={
          visible && keys.activeIndex >= 0
            ? listboxOptionId(listId, keys.activeIndex)
            : undefined
        }
        disabled={disabled}
        data-pretable-select=""
        data-pretable-site={site}
        data-pretable-value={value}
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
          trigger={triggerRef}
        />
      ) : null}
    </>
  );
});
