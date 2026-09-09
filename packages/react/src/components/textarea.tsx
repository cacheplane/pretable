import {
  createElement,
  forwardRef,
  useEffect,
  useRef,
  type TextareaHTMLAttributes,
  type ReactElement,
} from "react";

import { warnOnce } from "../dev-warn";
import { hasAccessibleName } from "./accessible-name";
import type { PretableSite } from "./button";
import { useComposedRefs } from "./compose-refs";

/** Native textarea attributes plus a kit site.
 * @public
 */
export interface PretableTextareaProps extends Omit<
  TextareaHTMLAttributes<HTMLTextAreaElement>,
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

/** A native multiline field. Value, events, sizing, and refs pass through.
 * Warns once when its mounted DOM has no recognized accessible-name source.
 * @public
 */
export const PretableTextarea = forwardRef<
  HTMLTextAreaElement,
  PretableTextareaProps
>(function PretableTextarea({ site, ...textareaProps }, ref): ReactElement {
  const ownRef = useRef<HTMLTextAreaElement>(null);
  const setRef = useComposedRefs(ownRef, ref);

  // A <label for> names it and props cannot see one: check the DOM once,
  // after mount.
  useEffect(() => {
    const el = ownRef.current;
    if (el && !hasAccessibleName(el)) {
      warnOnce(
        "textarea-empty-name",
        "[pretable] <PretableTextarea> rendered with no accessible name. " +
          "An unnamed field reads as a bare edit box to a screen reader. " +
          "Give it an aria-label, an aria-labelledby, or a <label for> its " +
          "id.",
      );
    }
  }, []);

  return (
    <textarea
      {...textareaProps}
      ref={setRef}
      data-pretable-textarea=""
      data-pretable-site={site}
    />
  );
});
