import { readdirSync } from "node:fs";
import { join, relative } from "node:path";

import { devices, expect, test } from "@playwright/test";

/**
 * No docs page may scroll the document horizontally on a phone.
 *
 * `/docs/grid/keyboard` did: an inline `<code>` token 43 characters long whose
 * only separators were `.` `[` `"` — none of which the browser treats as a soft
 * break opportunity under `white-space: normal`. It set the min-content width
 * of its container at 335px inside a 295px column and pushed the document to
 * 394px against a 390px viewport.
 *
 * Longer tokens elsewhere in the docs never overflowed, purely because they
 * contain `-` or `/`, which DO break. So the guard rail was missing shell-wide
 * and one page happened to express it. That is why this runs over every page
 * rather than the one that broke.
 *
 * Fenced blocks are exempt on purpose: `pre` keeps `white-space: pre` and
 * scrolls inside its own container. The assertion below is about the DOCUMENT
 * scrolling, never about content that scrolls within a box built to scroll.
 */
test.use({ ...devices["iPhone 13"] });

const ROOT = join(process.cwd(), "content", "docs");
function walk(d: string): string[] {
  return readdirSync(d, { withFileTypes: true }).flatMap((e) => {
    const p = join(d, e.name);
    return e.isDirectory() ? walk(p) : e.name.endsWith(".mdx") ? [p] : [];
  });
}
const PAGES = walk(ROOT).map((f) => {
  const r = relative(ROOT, f).replace(/\.mdx$/, "");
  return "/docs/" + (r.endsWith("/index") ? r.slice(0, -6) : r);
});

test("every docs page fits a phone viewport", async ({ page }) => {
  const offenders: string[] = [];

  for (const path of PAGES) {
    await page.goto(path, { waitUntil: "domcontentloaded" });
    const m = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      innerWidth: window.innerWidth,
    }));
    if (m.scrollWidth > m.innerWidth) {
      offenders.push(`${path}: ${m.scrollWidth}px > ${m.innerWidth}px`);
    }
  }

  expect(
    offenders,
    `docs pages scrolling horizontally at 390px:\n${offenders.join("\n")}`,
  ).toEqual([]);
  // Guard the guard: if the page list ever comes back empty, the loop above
  // asserts nothing and this test passes on nothing.
  expect(PAGES.length).toBeGreaterThan(30);
});

test("fenced code still scrolls inside its own box", async ({ page }) => {
  // The lazy fix for the bug above is to clamp something with `overflow:
  // hidden`, which stops the page scrolling by making wide code unreadable.
  // This is the assertion that rejects that fix.
  await page.goto("/docs/grid/keyboard", { waitUntil: "domcontentloaded" });
  const scrollers = await page.evaluate(() => {
    // NOT `pre.parentElement`. A fence's scroller is the pre's direct parent,
    // but an example's Code pane wraps the pre in a plain div and scrolls one
    // level higher — reading the immediate parent reports `overflow-x: visible`
    // and makes a working scroller look broken. Walk to the nearest ancestor
    // that actually scrolls.
    const scrollerFor = (el: Element): Element | null => {
      let p = el.parentElement;
      while (p && p !== document.body) {
        const ox = getComputedStyle(p).overflowX;
        if (ox === "auto" || ox === "scroll") return p;
        p = p.parentElement;
      }
      return null;
    };
    return [...document.querySelectorAll("pre")]
      .map((pre) => {
        const host = scrollerFor(pre);
        if (!host) return null;
        return {
          scrollW: host.scrollWidth,
          clientW: host.clientWidth,
          overflowX: getComputedStyle(host).overflowX,
        };
      })
      .filter((x): x is NonNullable<typeof x> => x !== null);
  });

  expect(scrollers.length).toBeGreaterThan(0);
  const wide = scrollers.filter((s) => s.scrollW > s.clientW + 1);
  expect(
    wide.length,
    "expected at least one code block wider than its box on this page",
  ).toBeGreaterThan(0);
  for (const s of wide) {
    expect(["auto", "scroll"]).toContain(s.overflowX);
  }
});
