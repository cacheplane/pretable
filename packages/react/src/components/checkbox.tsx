/**
 * The kit's checkbox: a `button[role="checkbox"]`, the model the row-select
 * cell, the column toggle and the boolean cell already used, now one
 * component for every site — the three native inputs included.
 *
 * A button rather than a styled native input because mixed state, the roving
 * tabindex in body cells and a glyph that takes the theme's tokens are all
 * plain on a button and a fight on an `<input>`: `indeterminate` is a DOM
 * property with no attribute, `tabindex="-1"` on an input still leaves a
 * focusable box in the tab order's way when it is re-enabled, and the tick is
 * the user agent's until `appearance: none` throws the whole control away.
 *
 * Styled by `@pretable/ui`'s grid.css through `data-pretable-checkbox` and
 * `aria-checked`; a site's own attribute (`data-pretable-row-select`) still
 * arrives through the spread, so nothing that identified a checkbox before
 * this component stops identifying it. The glyph is the grid's `CheckIcon` /
 * `MinusIcon`, sized from `--pretable-icon-size` like every other.
 *
 * Keyboard is the native button's — Space and Enter both activate, and both
 * arrive as a click — so there is no key handler here. The consumer's
 * `onClick` runs first and may `preventDefault()` to veto the toggle: how a
 * shift-click range select keeps its click without a second write.
 */
import {
  createElement,
  forwardRef,
  useCallback,
  useEffect,
  useRef,
  type ButtonHTMLAttributes,
  type ReactElement,
} from "react";

import { warnOnce } from "../dev-warn";
import { CheckIcon, MinusIcon } from "../icons";
import { hasAccessibleName } from "./accessible-name";
import type { PretableSite } from "./button";

/**
 * Props for {@link PretableCheckbox}.
 *
 * @public
 */
export interface PretableCheckboxProps extends Omit<
  ButtonHTMLAttributes<HTMLButtonElement>,
  "type" | "role" | "aria-checked" | "onChange" | "children"
> {
  /**
   * The state. `"mixed"` is the header select-all's partial selection — some
   * rows selected, not all — and renders the minus glyph.
   */
  checked: boolean | "mixed";
  /**
   * Called with the next value after a click, before anything is written:
   * this is a controlled component, and `checked` only changes when the
   * consumer changes it. `"mixed"` toggles to `true`.
   */
  onCheckedChange: (next: boolean) => void;
  /**
   * Where in the grid this checkbox is; lands as `data-pretable-site`. The
   * contract attributes are written after the spread, so a
   * `data-pretable-site` passed as a raw attribute is replaced by this
   * prop's value, or removed when the prop is absent.
   */
  site?: PretableSite;
}

/**
 * A checkbox in the grid's own chrome.
 *
 * The accessible name may come from an `aria-label` or from a wrapping
 * `<label>`; with neither, it warns once in development, the way
 * `PretableIconButton` does.
 *
 * ```tsx
 * <label>
 *   <PretableCheckbox
 *     site="hide-grouped"
 *     checked={hideGrouped}
 *     onCheckedChange={setHideGrouped}
 *   />
 *   Hide grouped columns
 * </label>
 * ```
 *
 * @public
 */
export const PretableCheckbox = forwardRef<
  HTMLButtonElement,
  PretableCheckboxProps
>(function PretableCheckbox(
  { checked, onCheckedChange, site, onClick, ...buttonProps },
  ref,
): ReactElement {
  const ownRef = useRef<HTMLButtonElement>(null);
  // One node, two readers: the component's own name check and the
  // consumer's ref. A merged callback ref, as in `PretableSelect` — writing
  // `ref` straight onto the button would leave the check with nothing to
  // read.
  const setRef = useCallback(
    (node: HTMLButtonElement | null) => {
      ownRef.current = node;
      if (typeof ref === "function") {
        ref(node);
      } else if (ref) {
        ref.current = node;
      }
    },
    [ref],
  );

  // The name may come from a wrapping <label>, which props cannot see: check
  // the DOM once, after mount.
  useEffect(() => {
    const el = ownRef.current;
    if (el && !hasAccessibleName(el)) {
      warnOnce(
        "checkbox-empty-name",
        "[pretable] <PretableCheckbox> rendered with no accessible name. " +
          "A checkbox with no name reads as an unnamed button to a screen " +
          "reader. Give it an aria-label, or wrap it in a <label> with " +
          "text, e.g. `Hide grouped columns`.",
      );
    }
  }, []);

  return (
    <button
      {...buttonProps}
      ref={setRef}
      type="button"
      role="checkbox"
      aria-checked={checked}
      data-pretable-checkbox=""
      data-pretable-site={site}
      onClick={(event) => {
        // Consumer first, then the toggle: a handler that wants the click
        // for itself — a shift-click range select — vetoes with
        // `preventDefault()` and no plain write follows.
        onClick?.(event);
        if (event.defaultPrevented) {
          return;
        }
        onCheckedChange(checked !== true);
      }}
    >
      {checked === true ? (
        <CheckIcon />
      ) : checked === "mixed" ? (
        <MinusIcon />
      ) : null}
    </button>
  );
});
