/**
 * The kit's push-buttons — the first two components of a collection the grid
 * renders its own chrome from and a consumer can replace per type through
 * `components` on the surface (see `./context.ts`).
 *
 * Both render `<button type="button">`, always: every grid button is
 * `type="button"`, and a stray submit inside a consumer's `<form>` is a real
 * bug class, so `type` is not a prop. `className` and `style` pass through
 * and merge — the component sets neither, so the consumer's IS the merge —
 * and the contract attributes follow the spread so no prop can displace them.
 *
 * Styled by `@pretable/ui`'s grid.css through the attributes written here.
 * That is the whole styling channel: `data-pretable-button` /
 * `data-pretable-icon-button` for the shared box, `data-pretable-variant` for
 * the two labelled looks, `data-pretable-site` for where in the grid the
 * button sits. A site's own attribute (`data-pretable-filter-clear`) still
 * arrives through the spread, so nothing that identified a button before
 * these existed stops identifying it.
 */
import {
  createElement,
  forwardRef,
  type ButtonHTMLAttributes,
  type ReactElement,
} from "react";

import { warnOnce } from "../dev-warn";

/**
 * The two labelled looks the grid uses: `ghost` (a 24px box with a hover
 * tint — `+ filter`, `Expand all`) and `link` (plain accent text — `Clear`,
 * `Reset columns`).
 *
 * @public
 */
export type PretableButtonVariant = "ghost" | "link";

/**
 * Where in the grid a built-in button sits. Each name is the site's own
 * `data-pretable-*` attribute suffix, so there is one vocabulary, not two.
 *
 * @public
 */
export type PretableBuiltInButtonSite =
  | "filter-add"
  | "add-group"
  | "expand-all"
  | "collapse-all"
  | "filter-clear"
  | "tool-reset"
  | "filter-funnel"
  | "column-menu-button"
  | "tool-row-menu-button"
  | "chip-remove"
  | "filter-row-remove"
  | "tool-group-remove";

/**
 * A built-in site, or any string: autocomplete for the grid's own, no type
 * error when a consumer names one of theirs. Same shape as
 * `PretableToolPanelSectionId`.
 *
 * @public
 */
export type PretableButtonSite = PretableBuiltInButtonSite | (string & {});

/**
 * Props for {@link PretableButton}.
 *
 * @public
 */
export interface PretableButtonProps extends Omit<
  ButtonHTMLAttributes<HTMLButtonElement>,
  "type"
> {
  /** The labelled look. Default: `"ghost"`. */
  variant?: PretableButtonVariant;
  /**
   * Where in the grid this button is; lands as `data-pretable-site`. A
   * replacement passed through `components` receives it and can branch on it.
   * Named `site`, not `role`: `role` is the ARIA attribute on every button.
   * The contract attributes are written after the spread, so a
   * `data-pretable-site` passed as a raw attribute is replaced by this
   * prop's value, or removed when the prop is absent.
   */
  site?: PretableButtonSite;
}

/**
 * Props for {@link PretableIconButton}.
 *
 * @public
 */
export interface PretableIconButtonProps extends Omit<
  ButtonHTMLAttributes<HTMLButtonElement>,
  "type" | "aria-label"
> {
  /**
   * Required. An icon-only button has no other accessible name, so omitting
   * it is a compile error rather than a WCAG failure discovered later. The
   * type system cannot stop an empty or whitespace-only string, which
   * warns in development instead.
   */
  "aria-label": string;
  /**
   * Where in the grid this button is; lands as `data-pretable-site`. The
   * contract attributes are written after the spread, so a
   * `data-pretable-site` passed as a raw attribute is replaced by this
   * prop's value, or removed when the prop is absent.
   */
  site?: PretableButtonSite;
}

/**
 * A labelled push-button in one of the grid's two looks.
 *
 * ```tsx
 * <PretableButton variant="link" site="filter-clear" onClick={clear}>
 *   Clear
 * </PretableButton>
 * ```
 *
 * @public
 */
export const PretableButton = forwardRef<
  HTMLButtonElement,
  PretableButtonProps
>(function PretableButton(
  { variant = "ghost", site, ...buttonProps },
  ref,
): ReactElement {
  return (
    <button
      {...buttonProps}
      ref={ref}
      type="button"
      data-pretable-button=""
      data-pretable-variant={variant}
      data-pretable-site={site}
    />
  );
});

/**
 * An icon-only push-button. The accessible name is required.
 *
 * ```tsx
 * <PretableIconButton aria-label={`Remove ${label}`} site="chip-remove">
 *   <CloseIcon />
 * </PretableIconButton>
 * ```
 *
 * @public
 */
export const PretableIconButton = forwardRef<
  HTMLButtonElement,
  PretableIconButtonProps
>(function PretableIconButton({ site, ...buttonProps }, ref): ReactElement {
  if (buttonProps["aria-label"].trim() === "") {
    warnOnce(
      "icon-button-empty-name",
      "[pretable] <PretableIconButton> rendered with an empty aria-label. " +
        "An icon-only button has no other accessible name, so screen-reader " +
        "users hear nothing for it. Pass the action it performs, e.g. " +
        "`Remove Alpha from grouping`.",
    );
  }

  return (
    <button
      {...buttonProps}
      ref={ref}
      type="button"
      data-pretable-icon-button=""
      data-pretable-site={site}
    />
  );
});
