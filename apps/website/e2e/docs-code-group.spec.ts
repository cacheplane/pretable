import { expect, test, type Page } from "@playwright/test";

/**
 * `<CodeGroup>` labels its tabs from the code surface each one wraps.
 *
 * The bug this guards was a React Server Components bug: `CodeGroup` read
 * `p.props["data-language"]` off its children, and its children are not the
 * `<Pre>`/`<CodeBlock>` elements the MDX author wrote. `Figure`, `Pre` and
 * `CodeBlock` are server components, so React serialises their OUTPUT across
 * the boundary and `CodeGroup` — a `"use client"` module — receives a host
 * `<figure>` wrapping a `CodeSurface` client reference. `data-language` sits
 * on a `<code>` several levels below and never on the child's own props, so
 * every tab fell back to `tab N`.
 *
 * It has to be tested here rather than in vitest. Under `compileMDX` in a
 * plain React tree there is no client boundary: the server components run
 * inline, the children are exactly what was written, and a jsdom test passes
 * against a tree no browser ever builds. `<Tabs>` proves the failure mode is
 * real — its unit test passed for years on an identity check while the live
 * page rendered nothing at all (see the note on `isTab` in `mdx/Tabs.tsx`).
 *
 * `/fixtures/code-group` is the page under test because `<CodeGroup>` is used
 * on zero pages under `content/docs`; the fixture compiles MDX through the
 * same `compileMDX` + rehype-pretty-code + `docsMdxComponents` path as
 * `lib/docs/load.ts`, from a server component, so the boundary is the real
 * one. See the header comment there.
 */

const FIXTURE_URL = "/fixtures/code-group";

/** The `title="grid.ts"` fence — the `filename` branch of the label lookup. */
const FILENAME_TAB = "grid.ts";
/** The untitled ```python fence — the `language` branch. */
const LANGUAGE_TAB = "python";

const tabs = (page: Page) => page.getByRole("tab");

test.describe("CodeGroup tab labels", () => {
  test("labels each tab from the code surface it wraps", async ({ page }) => {
    await page.goto(FIXTURE_URL);

    const tablist = page.getByRole("tablist");
    await expect(tablist).toBeVisible();

    // Both branches of the lookup, by accessible name. `grid.ts` can only come
    // from the fence's `title=` and `python` only from its language tag, so
    // neither is reachable if the label read resolves to `undefined`.
    await expect(tabs(page)).toHaveText([FILENAME_TAB, LANGUAGE_TAB]);

    // The negative half, and the load-bearing one: `tab 1` / `tab 2` is what
    // the broken read produced, and it is a PASSING render — the group still
    // draws two tabs over the right panels. Only the text discriminates, so
    // assert the fallback is absent rather than trusting that something
    // rendered.
    await expect(page.getByRole("tab", { name: "tab 1" })).toHaveCount(0);
    await expect(page.getByRole("tab", { name: "tab 2" })).toHaveCount(0);
  });

  test("carries the labels in the server-rendered HTML", async ({
    request,
  }) => {
    // The same assertion one layer earlier, with no client JavaScript in the
    // picture at all: if the labels are already in the streamed markup, they
    // were resolved from children that had crossed the RSC boundary — which is
    // precisely the read that used to fail. A DOM-only check could in
    // principle be satisfied by some post-hydration repair; this cannot.
    const response = await request.get(FIXTURE_URL);
    expect(response.ok()).toBe(true);
    const html = await response.text();

    expect(html).toContain(FILENAME_TAB);
    expect(html).toContain(LANGUAGE_TAB);
    expect(html).not.toContain("tab 1");
    expect(html).not.toContain("tab 2");
  });

  test("switching tabs swaps the visible surface", async ({ page }) => {
    // Proves the labels are attached to the panels they name, not just that
    // two strings render somewhere. Without this, `codeIdentity` could return
    // the same surface's identity twice and the test above would still pass.
    await page.goto(FIXTURE_URL);

    const first = page.getByRole("tab", { name: FILENAME_TAB });
    const second = page.getByRole("tab", { name: LANGUAGE_TAB });
    const panel = page.getByRole("tabpanel");

    await expect(first).toHaveAttribute("aria-selected", "true");
    await expect(panel).toContainText("export const columns");

    await second.click();
    await expect(second).toHaveAttribute("aria-selected", "true");
    await expect(panel).toContainText("columns = ");
    await expect(panel).not.toContainText("export const columns");
  });
});
