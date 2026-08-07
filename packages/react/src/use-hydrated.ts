import { useSyncExternalStore } from "react";

const subscribe = () => () => {};
const isClient = () => true;
const isServer = () => false;

/**
 * `false` on the server and throughout the hydration render, `true` from the
 * first client-only render onward.
 *
 * This is the canonical "am I live yet?" gate for the package — both the
 * overlay portal (which has no server counterpart) and the grid root's
 * `data-pretable-hydrated` attribute read it, so they flip in the same commit
 * rather than drifting apart.
 *
 * Deliberately a `useSyncExternalStore` store rather than `useState(false)` +
 * `useEffect(() => setState(true))`:
 *
 * - The effect form trips `react-hooks/set-state-in-effect`, which is on in
 *   this repo.
 * - It also defers the flip by an extra tick — the effect runs after the
 *   hydration commit, so the "hydrated" render lands one paint later than it
 *   needs to. That tick has already broken mount-effect focus here once.
 *
 * `useSyncExternalStore` instead resolves `getServerSnapshot` during SSR *and*
 * during the hydration render, so the server HTML and React's hydration pass
 * agree (no mismatch), then React immediately re-renders with the client
 * snapshot in the same commit phase.
 *
 * The store never changes, so `subscribe` returns a no-op unsubscribe and is
 * never called back.
 */
export function useHydrated(): boolean {
  return useSyncExternalStore(subscribe, isClient, isServer);
}
