/** Observe layout signals only while a popup is open; never poll for position. */
export function observeAnchor(
  anchor: HTMLElement,
  measure: () => void,
): () => void {
  const ownerWindow = anchor.ownerDocument.defaultView;
  if (!ownerWindow) return () => {};
  const mutation = new ownerWindow.MutationObserver(measure);
  const resize = ownerWindow.ResizeObserver
    ? new ownerWindow.ResizeObserver(measure)
    : null;
  for (let node: HTMLElement | null = anchor; node; node = node.parentElement) {
    mutation.observe(node, {
      attributes: true,
      attributeFilter: ["dir", "class", "style", "data-theme"],
    });
    resize?.observe(node);
  }
  ownerWindow.addEventListener("scroll", measure, true);
  ownerWindow.addEventListener("resize", measure);
  return () => {
    mutation.disconnect();
    resize?.disconnect();
    ownerWindow.removeEventListener("scroll", measure, true);
    ownerWindow.removeEventListener("resize", measure);
  };
}
