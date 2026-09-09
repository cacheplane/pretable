import {
  useCallback,
  useRef,
  type CompositionEvent,
  type KeyboardEvent,
} from "react";
import type { PretableFocusDirection } from "@pretable/core";

/** Shared command boundary for fields and the surface's edit-entry shortcuts. */
export function useCompositionGuard() {
  const target = useRef<EventTarget | null>(null);
  const onCompositionStart = useCallback((event: CompositionEvent) => {
    target.current = event.target;
  }, []);
  const onCompositionEnd = useCallback(() => {
    target.current = null;
  }, []);
  const isComposing = useCallback(
    (event: KeyboardEvent) =>
      event.nativeEvent.isComposing ||
      event.nativeEvent.keyCode === 229 ||
      target.current === event.target,
    [],
  );
  return { isComposing, onCompositionStart, onCompositionEnd };
}
export function editorCommitDirection(
  event: Pick<KeyboardEvent, "key" | "shiftKey">,
): PretableFocusDirection {
  return event.key === "Tab"
    ? event.shiftKey
      ? "left"
      : "right"
    : event.shiftKey
      ? "up"
      : "down";
}
