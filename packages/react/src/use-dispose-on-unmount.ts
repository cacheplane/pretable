import { useEffect, useState } from "react";

/**
 * Anything with a `dispose()` — a row model, a grid, a subscription handle.
 *
 * @public
 */
export interface PretableDisposable {
  dispose(): void;
}

/**
 * Dispose a resource when the component really unmounts — not when StrictMode
 * rehearses one.
 *
 * A row model you create is yours to dispose, and the obvious way to do it is
 * wrong in dev:
 *
 * ```tsx
 * const [rowModel] = useState(() => createLocalRowModel({ rows, columns }));
 * useEffect(() => () => rowModel.dispose(), [rowModel]); // ✗
 * ```
 *
 * React StrictMode mounts, unmounts and remounts every component in development,
 * and `useState` hands the same instance back to the remount — so that cleanup
 * destroys a model the component is about to keep using. The grid then reports
 * a disposed row-layout controller out of a layout effect and renders nothing.
 * It is not a subtle degradation: the whole grid is blank, in dev only, on every
 * app with `reactStrictMode` on. It cost this repo weeks of a dead homepage grid
 * (#382), and our own headless example shipped the same mistake.
 *
 * ```tsx
 * useDisposeOnUnmount(rowModel); // ✓
 * ```
 *
 * Deferring by a microtask lets the remount cancel the disposal; a real unmount
 * has no remount to cancel it, so the resource is still released. This is the
 * same shape `usePretable` uses for the models it owns — the hook exists so
 * consumers do not have to know that.
 *
 * @public
 */
export function useDisposeOnUnmount(
  disposable: PretableDisposable | null | undefined,
): void {
  // Per-component, so two components disposing the same resource cannot cancel
  // each other's pending disposal.
  const [pending] = useState(() => new Set<PretableDisposable>());

  useEffect(() => {
    if (!disposable) return;
    pending.delete(disposable);
    return () => {
      pending.add(disposable);
      queueMicrotask(() => {
        if (!pending.delete(disposable)) return;
        disposable.dispose();
      });
    };
  }, [disposable, pending]);
}
