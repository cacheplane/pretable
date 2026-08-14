/**
 * `tabIndex` value that puts a plain control into the sequential tab order.
 *
 * On every engine except Safari this is what a native `<button>` or `<a href>`
 * already has, so writing it out looks redundant — and deleting it as
 * redundant is exactly how this bug comes back. Hence the name: it is here for
 * WebKit, not for React.
 *
 * Safari keeps native buttons and links OUT of the sequential focus order
 * unless the reader has enabled Full Keyboard Access, which is off by default.
 * Such a control still takes focus programmatically and still fires on click,
 * so nothing in jsdom — and no Playwright `click()` — can tell the difference.
 * What a Safari reader actually got was an `<Example>` whose Tab sequence ran
 * view tab → file tab → code and skipped Expand, Copy file, Copy for agent and
 * the .md link outright, plus a fenced code block whose Copy was unreachable.
 * An explicit `tabindex="0"` opts each of them back in, and changes nothing in
 * Chromium or Firefox.
 *
 * Two things this must NOT be spread onto:
 *
 *   - Roving-tabindex tabs (the view and file tablists in `ExampleShell`).
 *     There, exactly one tab carries `tabindex="0"` and the rest carry `-1`,
 *     so Tab enters and leaves the strip once and the arrow keys move within
 *     it. Giving every tab a `0` would put all of them in the page's tab order
 *     and destroy the pattern. They need no help anyway: carrying an explicit
 *     `tabindex` is precisely what already makes the selected tab tabbable in
 *     Safari.
 *
 *   - Anything relying on `inert` to stay unreachable — though that is safe by
 *     construction, since `inert` removes a whole subtree from the focus order
 *     ahead of any `tabindex` inside it.
 *
 * Both of those, and the full expected sequence, are pinned in both engines by
 * `e2e/example-tab-order.spec.ts`. That spec presses real Tab keys and reads
 * `document.activeElement`; it is the only kind of test that can see this
 * regression at all.
 */
export const WEBKIT_TABBABLE = 0;
