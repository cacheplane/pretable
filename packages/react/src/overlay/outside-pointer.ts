import { useEffect, type RefObject } from "react";
import { logicallyContains } from "./logical-containment";

type Trigger = HTMLElement | RefObject<HTMLElement | null> | null;

/** Capture sees outside presses even when another control stops bubbling. */
export function useOutsidePointer(
  rootRef: RefObject<HTMLElement | null>,
  onClose: () => void,
  trigger?: Trigger,
): void {
  useEffect(() => {
    const anchor = () =>
      trigger && "current" in trigger ? trigger.current : trigger;
    const ownerDocument =
      rootRef.current?.ownerDocument ?? anchor()?.ownerDocument ?? document;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof ownerDocument.defaultView!.Node)) return;
      if (
        logicallyContains(rootRef.current, target) ||
        logicallyContains(anchor() ?? null, target)
      )
        return;
      onClose();
    };
    ownerDocument.addEventListener("pointerdown", onPointerDown, true);
    return () =>
      ownerDocument.removeEventListener("pointerdown", onPointerDown, true);
  }, [rootRef, onClose, trigger]);
}
