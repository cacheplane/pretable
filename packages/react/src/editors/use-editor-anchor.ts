import { useCallback, useLayoutEffect, useRef, useState } from "react";
import { EMPTY_RECT } from "../components/listbox";
import { observeAnchor } from "../overlay/observe-anchor";

/** Editor popup coordinates follow rendered layout and live ancestor scope changes. */
export function useEditorAnchor(visible: boolean) {
  const anchorRef = useRef<HTMLSpanElement>(null);
  const [rect, setRect] = useState<DOMRect>(EMPTY_RECT);
  const measure = useCallback(() => {
    const next = anchorRef.current?.getBoundingClientRect();
    if (next)
      setRect((previous) =>
        previous.left === next.left &&
        previous.top === next.top &&
        previous.width === next.width &&
        previous.height === next.height
          ? previous
          : next,
      );
  }, []);
  useLayoutEffect(() => {
    if (visible) measure();
  });
  useLayoutEffect(() => {
    if (!visible || !anchorRef.current) return;
    return observeAnchor(anchorRef.current, measure);
  }, [visible, measure]);
  return { anchorRef, rect };
}
