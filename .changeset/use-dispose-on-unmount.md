---
"@pretable/react": minor
---

Add `useDisposeOnUnmount`, a StrictMode-safe way to release a row model you own.

A model you create is yours to dispose, and the obvious way is wrong in development: React StrictMode mounts, unmounts and remounts every component, and `useState` hands the same instance back to the remount — so `useEffect(() => () => rowModel.dispose(), [rowModel])` destroys a model the component is about to keep using. The grid then reports a disposed row-layout controller out of a layout effect and renders nothing at all, in dev only, on every app with `reactStrictMode` on.

The hook defers disposal by a microtask so the remount can cancel it, and releases the resource on a real unmount. It is the same shape `usePretable` already uses for the models it owns; it exists so consumers do not have to know that.
