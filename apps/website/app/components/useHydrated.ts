"use client";

import { useSyncExternalStore } from "react";

const subscribe = () => () => {};
const isClient = () => true;
const isServer = () => false;

/**
 * `false` on the server and throughout the hydration render, `true` from the
 * first client-only render onward.
 *
 * The website's copy of `useHydrated` from `@pretable/react`
 * (packages/react/src/use-hydrated.ts), which is internal to that package and
 * not part of its public API. Same shape on purpose: a control that publishes
 * readiness should mean the same thing here as it does on the grid.
 *
 * Deliberately a `useSyncExternalStore` store rather than `useState(false)` +
 * `useEffect(() => setState(true))`:
 *
 * - The effect form trips `react-hooks/set-state-in-effect`, which is on in
 *   this repo (see the disables in `useDrawer` and `NavBar`).
 * - It also defers the flip by an extra tick — the effect runs after the
 *   hydration commit, so the "hydrated" render lands one paint later than it
 *   needs to.
 *
 * `useSyncExternalStore` instead resolves `getServerSnapshot` during SSR *and*
 * during the hydration render, so the server HTML and React's hydration pass
 * agree (no mismatch), then React immediately re-renders with the client
 * snapshot.
 *
 * The store never changes, so `subscribe` returns a no-op unsubscribe and is
 * never called back.
 */
export function useHydrated(): boolean {
  return useSyncExternalStore(subscribe, isClient, isServer);
}
