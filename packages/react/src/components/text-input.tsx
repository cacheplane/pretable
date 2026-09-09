/**
 * The kit's text field: the native `<input>`, no more. Deliberately — the
 * native element is the accessible one, so a screen reader, a password
 * manager and the platform's own autofill all keep working; `type="date"`
 * keeps its native picker, and `inputMode` keeps the right soft keyboard,
 * neither of which survives a wrapper that reinterprets `type`. What a theme
 * needs from this control is only the box, which `@pretable/ui`'s grid.css
 * draws through `data-pretable-text-input`.
 *
 * Chrome fields and cell editors own their value and commit semantics.
 * This control adds no wrapper, clear button, or debounce.
 *
 * A site's own attribute (`data-pretable-filter-value`) still arrives through
 * the spread, so nothing that identified a field before this component stops
 * identifying it; `site` lands as `data-pretable-site`, written after the
 * spread so no prop can displace it.
 */
import {
  createElement,
  forwardRef,
  useEffect,
  useRef,
  type InputHTMLAttributes,
  type ReactElement,
} from "react";

import { warnOnce } from "../dev-warn";
import { hasAccessibleName } from "./accessible-name";
import type { PretableSite } from "./button";
import { useComposedRefs } from "./compose-refs";

/**
 * Props for {@link PretableTextInput}: the native input's, plus `site`.
 *
 * @public
 */
export interface PretableTextInputProps extends Omit<
  InputHTMLAttributes<HTMLInputElement>,
  "children"
> {
  /**
   * Where in the grid this field is; lands as `data-pretable-site`. A
   * replacement passed through `components` receives it and can branch on it.
   * Named `site`, not `role`: `role` is the ARIA attribute on every element.
   * The contract attributes are written after the spread, so a
   * `data-pretable-site` passed as a raw attribute is replaced by this
   * prop's value, or removed when the prop is absent.
   */
  site?: PretableSite;
}

/**
 * A native text field for grid chrome and cell editors.
 *
 * `type`, `inputMode`, `value`, `onChange`, `className`, `style` and every
 * other input attribute pass straight through — this is the native element,
 * so a date field is a date field and a numeric filter still asks for the
 * numeric keyboard.
 *
 * The accessible name may come from an `aria-label`, an `aria-labelledby`, or
 * a `<label for>` naming its id; with none of them, it warns once per page,
 * the way `PretableCheckbox` does.
 *
 * ```tsx
 * <PretableTextInput
 *   site="filter-value"
 *   aria-label="Filter value"
 *   value={value}
 *   onChange={(event) => setValue(event.target.value)}
 * />
 * ```
 *
 * @public
 */
export const PretableTextInput = forwardRef<
  HTMLInputElement,
  PretableTextInputProps
>(function PretableTextInput({ site, ...inputProps }, ref): ReactElement {
  const ownRef = useRef<HTMLInputElement>(null);
  const setRef = useComposedRefs(ownRef, ref);

  // A <label for> names it and props cannot see one: check the DOM once,
  // after mount.
  useEffect(() => {
    const el = ownRef.current;
    if (el && !hasAccessibleName(el)) {
      warnOnce(
        "text-input-empty-name",
        "[pretable] <PretableTextInput> rendered with no accessible name. " +
          "An unnamed field reads as a bare edit box to a screen reader. " +
          "Give it an aria-label, an aria-labelledby, or a <label for> its " +
          "id.",
      );
    }
  }, []);

  return (
    <input
      {...inputProps}
      ref={setRef}
      data-pretable-text-input=""
      data-pretable-site={site}
    />
  );
});
