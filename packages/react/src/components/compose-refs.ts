import { useMemo, type Ref } from "react";

/** Compose refs without returning a cleanup to React (also works in React 18). */
export function composeRefs<T>(
  ...refs: (Ref<T> | undefined)[]
): (node: T | null) => void {
  let detach: (() => void) | undefined;
  return (node) => {
    const previous = detach;
    detach = undefined;
    previous?.();
    if (node === null) return;
    const cleanups = refs.map((ref) => {
      if (typeof ref === "function") {
        const cleanup = ref(node);
        return typeof cleanup === "function" ? cleanup : () => ref(null);
      }
      if (ref) {
        ref.current = node;
        return () => {
          ref.current = null;
        };
      }
      return undefined;
    });
    detach = () => {
      for (const cleanup of cleanups) cleanup?.();
    };
  };
}

/** Stable identity avoids detaching and reattaching consumer refs on rerender. */
export function useComposedRefs<T>(
  first: Ref<T> | undefined,
  second: Ref<T> | undefined,
): (node: T | null) => void {
  return useMemo(() => composeRefs(first, second), [first, second]);
}
