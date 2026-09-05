/**
 * How a consumer's replacement reaches every place the grid renders a kit
 * component, and how the grid reads it.
 *
 * ONE slot per component type. `components={{ Button: MyButton }}` on the
 * surface replaces every button the grid draws; the props ours passes —
 * `site` included — are exactly what the replacement receives, so it can
 * branch on `site` to treat one place differently. No per-site public names:
 * the API does not grow a name for every control the grid gains.
 *
 * CONTEXT, not props. pretable portals its popovers — the filter dialog, the
 * column menus — into document.body. Context crosses a portal; props do not,
 * and the popovers are exactly where an override matters most. The value is
 * resolved once at the surface and memoised on the identity of each slot, so
 * an inline `{{ Button: MyButton }}` literal does not re-render every button
 * on every keystroke.
 *
 * The default context value is the built-in map, so a kit component rendered
 * outside any surface still resolves.
 */
import {
  createContext,
  useContext,
  useMemo,
  type ComponentType,
  type RefAttributes,
} from "react";

import {
  PretableButton,
  PretableIconButton,
  type PretableButtonProps,
  type PretableIconButtonProps,
} from "./button";

/**
 * The component a `components.Button` replacement must be: it receives
 * {@link PretableButtonProps} and forwards its `ref` to the button node —
 * the one obligation on a replacement, since the grid anchors menus on and
 * returns focus to that node. Under React 18 that means `forwardRef`; under
 * React 19 a plain `ref` prop is enough. A plain function component compiles
 * into this slot under both — the type cannot tell them apart — so this is
 * the one obligation the docs carry rather than the compiler.
 *
 * @public
 */
export type PretableButtonComponent = ComponentType<
  PretableButtonProps & RefAttributes<HTMLButtonElement>
>;

/**
 * The component a `components.IconButton` replacement must be.
 *
 * @public
 */
export type PretableIconButtonComponent = ComponentType<
  PretableIconButtonProps & RefAttributes<HTMLButtonElement>
>;

/**
 * The kit components a consumer can replace, one slot per type. Every slot is
 * optional; an absent one is the built-in.
 *
 * @public
 */
export interface PretableComponents {
  /** Every labelled push-button the grid draws; receives {@link PretableButtonProps}. */
  readonly Button?: PretableButtonComponent;
  /** Every icon-only push-button the grid draws; receives {@link PretableIconButtonProps}. */
  readonly IconButton?: PretableIconButtonComponent;
}

/** The map after resolution: every slot filled. Internal. */
export interface ResolvedPretableComponents {
  readonly Button: PretableButtonComponent;
  readonly IconButton: PretableIconButtonComponent;
}

/** The built-ins, frozen: also the identity a no-op resolution returns. */
export const DEFAULT_COMPONENTS: ResolvedPretableComponents = Object.freeze({
  Button: PretableButton,
  IconButton: PretableIconButton,
});

const PretableComponentsContext =
  createContext<ResolvedPretableComponents>(DEFAULT_COMPONENTS);
PretableComponentsContext.displayName = "PretableComponents";

/** Wraps the surface's tree. Internal — the public entry is the surface prop. */
export const PretableComponentsProvider = PretableComponentsContext.Provider;

/** What a call site renders its button from. Internal. */
export function usePretableComponents(): ResolvedPretableComponents {
  return useContext(PretableComponentsContext);
}

/**
 * Merge a consumer's map over the defaults, memoised on the identity of each
 * slot's VALUE rather than of the map, so a fresh object literal carrying the
 * same components resolves to the same object — and the defaults, when
 * nothing is replaced, to the frozen `DEFAULT_COMPONENTS` itself.
 */
export function useResolvedComponents(
  components: PretableComponents | undefined,
): ResolvedPretableComponents {
  const Button = components?.Button ?? DEFAULT_COMPONENTS.Button;
  const IconButton = components?.IconButton ?? DEFAULT_COMPONENTS.IconButton;
  return useMemo(
    () =>
      Button === DEFAULT_COMPONENTS.Button &&
      IconButton === DEFAULT_COMPONENTS.IconButton
        ? DEFAULT_COMPONENTS
        : Object.freeze({ Button, IconButton }),
    [Button, IconButton],
  );
}
