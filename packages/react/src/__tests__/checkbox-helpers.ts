/**
 * Shared reader for the kit checkbox's state. Not a `.test.` file on purpose:
 * vitest collects by that infix, and this file has no tests of its own.
 */

/**
 * The kit checkbox's state, from the attribute it renders for exactly this.
 *
 * A `button[role="checkbox"]` has no `.checked`, so every test that used to
 * read one reads `aria-checked` — which is also the attribute grid.css styles
 * the glyph and box from, so the assertion and the paint agree by
 * construction.
 */
export function checkboxState(el: Element): boolean | "mixed" {
  const v = el.getAttribute("aria-checked");
  return v === "mixed" ? "mixed" : v === "true";
}
