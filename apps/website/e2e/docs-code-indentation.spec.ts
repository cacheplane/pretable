import { expect, test } from "@playwright/test";

/**
 * Fenced code blocks must render their leading indentation.
 *
 * `MdxRenderer`'s `Pre` mapping hands `CodeSurface` rehype-pretty-code's
 * `<code>` and drops the `<pre>` that wrapped it. Without a `<pre>` nothing
 * supplies `white-space: pre`, so every leading space collapsed — and because
 * that `<code>` is `display: grid` (one grid row per line), the lines still
 * broke in the right places. Only the indent vanished, which is why nothing
 * caught it: line counts, text content and `toContainText` all still passed.
 *
 * So assert GEOMETRY, not markup. A line whose text starts with whitespace has
 * to paint further right than a line that starts at column zero. That is the
 * only form of this assertion that a collapsed indent can fail.
 *
 * Measure the first non-space GLYPH, not the line element's box. Every
 * `span[data-line]` is a grid item in the same grid column, so its own left
 * edge is identical on every line whether or not the indent renders — an
 * earlier version of this test compared line boxes and reported the bug as
 * still broken after it was fixed. Walk to the first non-whitespace character
 * and measure a Range around it.
 */
const PAGE = "/docs/headless/getting-started";

test("fenced code blocks preserve leading indentation", async ({ page }) => {
  await page.goto(PAGE, { waitUntil: "domcontentloaded" });

  // Fences, not examples: an `<Example>`'s Code pane always had a real `<pre>`
  // and was never affected, so including it would let a passing example mask a
  // broken fence.
  const fences = page
    .locator("figure")
    .filter({ hasNot: page.getByRole("tablist", { name: "Example view" }) });

  const count = await fences.count();
  expect(count, `${PAGE} should render fenced code blocks`).toBeGreaterThan(0);

  let checked = 0;
  for (let i = 0; i < count; i++) {
    const offsets = await fences.nth(i).evaluate((fig) => {
      const glyphLeft = (line: Element): number | null => {
        const walker = document.createTreeWalker(line, NodeFilter.SHOW_TEXT);
        let node: Node | null;
        while ((node = walker.nextNode())) {
          const at = (node.textContent ?? "").search(/\S/);
          if (at < 0) continue;
          const range = document.createRange();
          range.setStart(node, at);
          range.setEnd(node, at + 1);
          return range.getBoundingClientRect().left;
        }
        return null;
      };
      const lines = [...fig.querySelectorAll("span[data-line]")];
      const flat = lines.find((l) => /^\S/.test(l.textContent ?? ""));
      const indented = lines.find((l) => /^[ \t]+\S/.test(l.textContent ?? ""));
      if (!flat || !indented) return null;
      const a = glyphLeft(flat);
      const b = glyphLeft(indented);
      if (a === null || b === null) return null;
      return { flat: a, indented: b };
    });
    if (!offsets) continue;
    checked++;
    expect(
      offsets.indented,
      `fence #${i}: an indented line must paint right of a column-zero line`,
    ).toBeGreaterThan(offsets.flat);
  }

  // Guard the guard: if no fence on this page happens to contain both a
  // column-zero line and an indented one, the loop above asserts nothing and
  // this test would pass vacuously forever.
  expect(
    checked,
    `${PAGE} no longer has a fence mixing indented and unindented lines — ` +
      `this test needs a different page, it is not passing on merit`,
  ).toBeGreaterThan(0);
});
