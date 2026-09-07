/**
 * The half of an accessible name a component cannot see in its own props.
 *
 * `aria-label` arrives as a prop and is checked in render, the way
 * `PretableIconButton` checks it. A wrapping `<label>`, a `<label for>`
 * pointing at the control's id, and an `aria-labelledby` that resolves
 * elsewhere in the document are all facts about the rendered tree, not the
 * props — so they can only be read from the DOM, after mount.
 *
 * @internal
 */

/**
 * Whether a rendered control has an accessible name from any of the sources
 * the kit can see once it is in the document: `aria-label`,
 * `aria-labelledby`, a wrapping `<label>`, or a `<label for>` naming its id.
 *
 * Deliberately not a full accname computation — this backs a development
 * warning, so the bar is "would a screen reader have anything to say", and a
 * false negative that nags is worse than an exotic naming path it misses.
 * Called once after mount, never in a hot path.
 *
 * @internal
 */
export function hasAccessibleName(el: HTMLElement): boolean {
  if ((el.getAttribute("aria-label") ?? "").trim() !== "") {
    return true;
  }
  if ((el.getAttribute("aria-labelledby") ?? "").trim() !== "") {
    return true;
  }
  if (el.closest("label")) {
    return true;
  }
  const { id } = el;
  if (id && el.ownerDocument.querySelector(`label[for="${CSS.escape(id)}"]`)) {
    return true;
  }
  return false;
}
