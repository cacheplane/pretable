/**
 * A bounded naming heuristic for the kit's once-per-page warnings in every
 * build. Checks nonempty aria-label, resolved reference text, native label
 * text, and title. This is not the full accessible-name algorithm: hidden
 * content, image alternatives, and naming precedence may differ.
 * @internal
 */
export function hasAccessibleName(el: HTMLElement): boolean {
  const meaningful = (text: string | null | undefined) => Boolean(text?.trim());
  if (meaningful(el.getAttribute("aria-label"))) return true;
  const ids = (el.getAttribute("aria-labelledby") ?? "").trim().split(/\s+/);
  if (
    ids.some((id) =>
      meaningful(el.ownerDocument.getElementById(id)?.textContent),
    )
  )
    return true;
  const labels = "labels" in el ? (el as HTMLInputElement).labels : null;
  if (
    labels &&
    Array.from(labels).some((label) => meaningful(label.textContent))
  )
    return true;
  return meaningful(el.getAttribute("title"));
}
