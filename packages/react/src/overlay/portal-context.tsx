import {
  createContext,
  createElement,
  useContext,
  type ReactNode,
  type ReactElement,
} from "react";
import { useHydrated } from "../use-hydrated";

const PortalContainerContext = createContext<HTMLElement | null | undefined>(
  undefined,
);

/**
 * Props for {@link PretableOverlayProvider}.
 *
 * @public
 */
export interface PretableOverlayProviderProps {
  /** Connected, same-document portal host outside the grid's clipping viewport. Null waits for a host. */
  container: HTMLElement | null;
  children: ReactNode;
}

/**
 * Places overlays in the nearest provider's host, inheriting that host's CSS scope.
 * Without a provider, overlays use document.body. A null target renders no popup
 * until a host is supplied; it never falls back to body.
 * @public
 */
export function PretableOverlayProvider({
  container,
  children,
}: PretableOverlayProviderProps): ReactElement {
  return (
    <PortalContainerContext.Provider value={container}>
      {children}
    </PortalContainerContext.Provider>
  );
}

// eslint-disable-next-line react-refresh/only-export-components -- the provider and its internal target reader share one context
export function useOverlayContainer(): HTMLElement | null {
  const container = useContext(PortalContainerContext);
  const hydrated = useHydrated();
  if (!hydrated || typeof document === "undefined") return null;
  return container === undefined ? document.body : container;
}
