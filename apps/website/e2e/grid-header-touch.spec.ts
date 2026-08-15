import { devices, expect, test, type Page } from "@playwright/test";

import {
  dragResizeHandle,
  waitForGridReady,
  waitForStablePosition,
} from "./helpers";

/**
 * The header's overlay controls, measured by hit test.
 *
 * Every assertion here is one jsdom structurally cannot make. The tap target of
 * the filter funnel is a transparent `::after`, and jsdom answers
 * `getComputedStyle(el, "::after")` with "Not implemented" — it also lays
 * nothing out, so a computed `width` would be `""` on a box that is `0x0`
 * anyway. The only instrument that measures a tap target is
 * `document.elementFromPoint`, and the only place it means anything is a
 * browser that lays out.
 *
 * `pointer: coarse` is emulated by the iPhone 13 profile below; `pointer: fine`
 * is the suite's ordinary desktop projects. The fine half is not decoration —
 * two of these rules DELETE a control on touch, and a test that only checks the
 * control is gone would pass just as happily if the control were broken
 * everywhere.
 *
 * See `apps/website/app/fixtures/header-touch/page.tsx` for why the fixture is
 * shaped the way it is.
 */

const FIXTURE = "/fixtures/header-touch";

/**
 * The three tiers, with the `--pretable-header-height` each one resolves to in
 * the docs site's theme (`@pretable/ui/themes/pretable.css`).
 *
 * The token is asserted on every navigation, and that assertion is not
 * ceremony: the first version of this file set `data-density` from an init
 * script that ran before `<html>` existed, so the attribute was silently never
 * applied and all three "densities" measured the `:root` tier. Every number in
 * the matrix was the same number, and the suite was green. A tier that cannot
 * be told apart from the default is not a tier.
 *
 * `standard` is `:root` — `pretable.css` declares selectors only for the two
 * non-default tiers — so compact and spacious are the two that can disprove.
 */
const DENSITIES = {
  compact: "44px",
  standard: "52px",
  spacious: "60px",
} as const;

/**
 * The iPhone 13 profile, minus `defaultBrowserType` (a project-level key that
 * `test.use` has no slot for).
 *
 * `isMobile` + `hasTouch` are what make the engine report `pointer: coarse` and
 * `hover: none`; the viewport and scale factor are what make the numbers below
 * describe a phone rather than a narrow desktop window. Every one of them is
 * asserted rather than assumed — see the `emulates a coarse pointer` test,
 * without which every coarse expectation in this file would pass vacuously on a
 * fine-pointer browser.
 */
const { viewport, userAgent, deviceScaleFactor, isMobile, hasTouch } =
  devices["iPhone 13"];
const IPHONE_13 = {
  viewport,
  userAgent,
  deviceScaleFactor,
  isMobile,
  hasTouch,
};

/** Both grids on the fixture: with the group panel (3 controls) and without (2). */
const WITH_PANEL = "#with-panel";
const NO_PANEL = "#no-panel";

/**
 * The overlay anchor is a zero-width box parked exactly on a column's trailing
 * edge; every control is placed by counting BACK from it. Measuring against the
 * anchor rather than the viewport is what makes the fine-pointer numbers below
 * stable under horizontal scroll and independent of where the column starts.
 */
function anchorSel(scope: string, columnId: string): string {
  return `${scope} [data-pretable-header-overlays][data-pretable-column-id="${columnId}"]`;
}

function controls(scope: string, columnId: string) {
  const anchor = anchorSel(scope, columnId);
  return {
    anchor,
    resize: `${anchor} [data-pretable-resize-handle]`,
    funnelSlot: `${anchor} [data-pretable-filter-funnel-slot]`,
    funnel: `${anchor} [data-pretable-filter-funnel]`,
    menuSlot: `${anchor} [data-pretable-column-menu-slot]`,
    menu: `${anchor} [data-pretable-column-menu-button]`,
  };
}

interface HitTarget {
  /** `false` when the element generates no boxes at all (`display: none`). */
  rendered: boolean;
  clientRects: number;
  /** The DRAWN box — the glyph. Deliberately separate from the tap target. */
  drawnWidth: number;
  drawnHeight: number;
  /** Integer `elementFromPoint` samples, 1px steps, contiguous through the centre. */
  sampledWidth: number;
  sampledHeight: number;
  /** The same run with each boundary bisected into the 1px gap that brackets it. */
  preciseWidth: number;
  preciseHeight: number;
  opacity: string;
  /** What actually answers at the control's own centre, when it is not the control. */
  blockedBy: string | null;
}

/**
 * Hit-test sweep: `document.elementFromPoint` at 1px steps outward from a
 * control's centre, in both axes, reporting the contiguous run that answers
 * with the control.
 *
 * This is the measurement, not `getBoundingClientRect().width`. The funnel's
 * extra 6px of target is a transparent out-of-flow `::after`, so the button's
 * own box is 18px wide however big the target is; and the failure this file
 * exists to catch is the opposite direction — a control whose box says 18 but
 * whose reachable target is 17 because a sibling paints over it. Only a hit
 * test can tell either of those stories.
 *
 * Pseudo-elements are not returned by `elementFromPoint`; a point over the
 * funnel's `::after` answers with the funnel button itself, which is exactly
 * the identity being asked about.
 *
 * `precise*` refines each of the four boundaries by bisecting the 1px interval
 * the integer sweep has already bracketed. Six halvings put it within 1/64 px,
 * biased low (the search converges onto the last point that still HITS), so a
 * true 24px box measures ~23.97 and never 24.03.
 */
async function measureTarget(
  page: Page,
  selector: string,
): Promise<HitTarget | null> {
  return page.evaluate((sel) => {
    const el = document.querySelector(sel);
    if (el === null) return null;
    const styles = getComputedStyle(el);
    const rect = el.getBoundingClientRect();
    const describe = (node: Element | null): string | null => {
      if (node === null) return null;
      const named = node.closest<HTMLElement>(
        "[data-pretable-resize-handle],[data-pretable-filter-funnel],[data-pretable-column-menu-button],[data-pretable-header-cell]",
      );
      if (named !== null) {
        return (
          Object.keys(named.dataset).find((k) => k.startsWith("pretable")) ??
          named.tagName
        );
      }
      return node.tagName.toLowerCase();
    };

    if (el.getClientRects().length === 0) {
      return {
        rendered: false,
        clientRects: 0,
        drawnWidth: rect.width,
        drawnHeight: rect.height,
        sampledWidth: 0,
        sampledHeight: 0,
        preciseWidth: 0,
        preciseHeight: 0,
        opacity: styles.opacity,
        blockedBy: null,
      };
    }

    const owns = (x: number, y: number): boolean => {
      const hit = document.elementFromPoint(x, y);
      return hit !== null && (hit === el || el.contains(hit));
    };
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;

    const sweep = (horizontal: boolean) => {
      const at = (t: number) => (horizontal ? owns(t, cy) : owns(cx, t));
      const centre = Math.round(horizontal ? cx : cy);
      if (!at(centre)) return { samples: 0, precise: 0 };
      let lo = centre;
      let hi = centre;
      let samples = 1;
      while (centre - lo < 200 && at(lo - 1)) {
        lo -= 1;
        samples += 1;
      }
      while (hi - centre < 200 && at(hi + 1)) {
        hi += 1;
        samples += 1;
      }
      const edge = (inside: number, outside: number) => {
        for (let i = 0; i < 6; i += 1) {
          const mid = (inside + outside) / 2;
          if (at(mid)) inside = mid;
          else outside = mid;
        }
        return inside;
      };
      return { samples, precise: edge(hi, hi + 1) - edge(lo, lo - 1) };
    };

    const horizontal = sweep(true);
    const vertical = sweep(false);
    return {
      rendered: true,
      clientRects: el.getClientRects().length,
      drawnWidth: rect.width,
      drawnHeight: rect.height,
      sampledWidth: horizontal.samples,
      sampledHeight: vertical.samples,
      preciseWidth: Math.round(horizontal.precise * 100) / 100,
      preciseHeight: Math.round(vertical.precise * 100) / 100,
      opacity: styles.opacity,
      blockedBy: owns(cx, cy)
        ? null
        : describe(document.elementFromPoint(cx, cy)),
    };
  }, selector);
}

/** Offset of a control's leading edge from the column's trailing edge, in px. */
async function slotOffsets(page: Page, scope: string, columnId: string) {
  const sel = controls(scope, columnId);
  return page.evaluate(
    ({ anchor, resize, funnelSlot, menuSlot }) => {
      const origin = document.querySelector(anchor)?.getBoundingClientRect();
      if (origin === undefined) return null;
      const offset = (s: string) => {
        const el = document.querySelector(s);
        if (el === null) return null;
        const r = el.getBoundingClientRect();
        // Rounded to 1/100 px: a fractional device pixel ratio makes the
        // engine hand back values like -21.999998 for a literal -22px.
        return {
          left: Math.round((r.left - origin.left) * 100) / 100,
          width: Math.round(r.width * 100) / 100,
        };
      };
      return {
        resize: offset(resize),
        funnelSlot: offset(funnelSlot),
        menuSlot: offset(menuSlot),
      };
    },
    { ...sel },
  );
}

async function gotoFixture(
  page: Page,
  density: keyof typeof DENSITIES,
): Promise<void> {
  // An init script runs before ANY page script — which includes before `<html>`
  // itself has been parsed into existence, so `document.documentElement` is
  // null here and a bare `setAttribute` throws into the void. Measured: the
  // init script reported `{documentElement: false, readyState: "loading"}`.
  // Observing the document for its root element lands the attribute in the
  // microtask checkpoint right after `<html>` is appended, which is still long
  // before hydration — and hydration is the deadline, because
  // `getDensityHeights` reads these tokens synchronously on the surface's first
  // measuring render and sizes the whole virtualisation geometry from them.
  await page.addInitScript((d) => {
    const apply = () =>
      document.documentElement.setAttribute("data-density", d);
    if (document.documentElement !== null) {
      apply();
      return;
    }
    new MutationObserver((_records, observer) => {
      if (document.documentElement === null) return;
      apply();
      observer.disconnect();
    }).observe(document, { childList: true, subtree: true });
  }, density);
  await page.goto(FIXTURE, { waitUntil: "domcontentloaded" });
  // ...and prove it landed, before anything is measured under it.
  const token = await page.evaluate(() =>
    getComputedStyle(document.documentElement)
      .getPropertyValue("--pretable-header-height")
      .trim(),
  );
  expect(token, `data-density="${density}" never took`).toBe(
    DENSITIES[density],
  );
  await waitForGridReady(page, WITH_PANEL);
  await waitForGridReady(page, NO_PANEL);
  await waitForStablePosition(
    page.locator(`${WITH_PANEL} [data-pretable-header-row]`),
  );
}

// ---------------------------------------------------------------------------
// Coarse pointer
// ---------------------------------------------------------------------------

test.describe("coarse pointer (iPhone 13)", () => {
  test.use(IPHONE_13);

  test("emulates a coarse pointer with no hover", async ({ page }) => {
    // The gate for this whole describe block. Every expectation below is
    // written inside `@media (pointer: coarse)`, so on an engine that does not
    // emulate it they would all still pass — against the fine-pointer rules,
    // silently measuring nothing.
    await gotoFixture(page, "standard");
    const media = await page.evaluate(() => ({
      coarse: matchMedia("(pointer: coarse)").matches,
      fine: matchMedia("(pointer: fine)").matches,
      hover: matchMedia("(hover: hover)").matches,
    }));
    expect(media, JSON.stringify(media)).toEqual({
      coarse: true,
      fine: false,
      hover: false,
    });
  });

  for (const density of Object.keys(DENSITIES) as (keyof typeof DENSITIES)[]) {
    test(`renders no resize strip — ${density}`, async ({ page }) => {
      await gotoFixture(page, density);
      for (const scope of [WITH_PANEL, NO_PANEL]) {
        const strip = await measureTarget(
          page,
          controls(scope, "alpha").resize,
        );
        expect(
          strip,
          `${scope}: no resize handle element at all`,
        ).not.toBeNull();
        // "Not rendered" in the CSS sense — it generates no boxes, so it is
        // neither painted nor hit-testable. Asserting `toHaveCount(0)` would be
        // asserting a React implementation detail; asserting zero client rects
        // is asserting the property that matters to a finger.
        expect(strip!.rendered, `${scope}: strip still generates boxes`).toBe(
          false,
        );
        expect(strip!.clientRects).toBe(0);
        expect(strip!.sampledWidth).toBe(0);
      }
    });

    test(`shows the funnel at rest — ${density}`, async ({ page }) => {
      await gotoFixture(page, density);
      // No filter is active and nothing is hovered: on a phone there is no
      // hover to reveal it with, so `opacity: 1` here is the whole difference
      // between a 24px target and a 24px target nobody can see.
      for (const scope of [WITH_PANEL, NO_PANEL]) {
        const funnel = await measureTarget(
          page,
          controls(scope, "alpha").funnel,
        );
        expect(funnel, `${scope}: no funnel`).not.toBeNull();
        expect(funnel!.opacity, `${scope}: funnel opacity`).toBe("1");
      }
      // ...and the reveal is not being faked by a hover the harness left on.
      const active = await page
        .locator(
          `${WITH_PANEL} [data-pretable-filter-funnel][data-pretable-filter-active="true"]`,
        )
        .count();
      expect(active, "a filter was active; the reveal proves nothing").toBe(0);
    });

    test(`gives the funnel a 24px target — ${density}`, async ({ page }) => {
      await gotoFixture(page, density);
      for (const scope of [WITH_PANEL, NO_PANEL]) {
        const funnel = await measureTarget(
          page,
          controls(scope, "alpha").funnel,
        );
        expect(funnel, `${scope}: no funnel`).not.toBeNull();
        const seen = `${scope} @ ${density}: ${JSON.stringify(funnel)}`;
        expect(funnel!.blockedBy, seen).toBeNull();
        // The glyph must NOT have grown — the button is the box the hover chip
        // and focus ring paint on, and the header box is measured in JS.
        expect(funnel!.drawnWidth, seen).toBeCloseTo(18, 1);
        expect(funnel!.drawnHeight, seen).toBeCloseTo(18, 1);
        expect(funnel!.sampledWidth, seen).toBeGreaterThanOrEqual(24);
        expect(funnel!.sampledHeight, seen).toBeGreaterThanOrEqual(24);
        expect(funnel!.preciseWidth, seen).toBeGreaterThanOrEqual(23.9);
        expect(funnel!.preciseHeight, seen).toBeGreaterThanOrEqual(23.9);
      }
    });

    test(`gives the column menu a 24px target under the group panel — ${density}`, async ({
      page,
    }) => {
      await gotoFixture(page, density);
      // The group panel is the three-control case, and the one that squeezes:
      // the funnel measured ~17px wide here because the menu button paints over
      // its hit area inside a 40px slot.
      const menu = await measureTarget(
        page,
        controls(WITH_PANEL, "alpha").menu,
      );
      expect(
        menu,
        "no column menu button under the group panel",
      ).not.toBeNull();
      const seen = `@ ${density}: ${JSON.stringify(menu)}`;
      expect(menu!.blockedBy, seen).toBeNull();
      expect(menu!.drawnWidth, seen).toBeCloseTo(18, 1);
      expect(menu!.drawnHeight, seen).toBeCloseTo(18, 1);
      expect(menu!.sampledWidth, seen).toBeGreaterThanOrEqual(24);
      expect(menu!.sampledHeight, seen).toBeGreaterThanOrEqual(24);
      expect(menu!.preciseWidth, seen).toBeGreaterThanOrEqual(23.9);
      expect(menu!.preciseHeight, seen).toBeGreaterThanOrEqual(23.9);
    });

    test(`leaves the header box alone — ${density}`, async ({ page }) => {
      await gotoFixture(page, density);
      // `getDensityHeights` reads header and row height in JS to drive
      // virtualisation geometry, so a CSS change that grew the PAINTED header
      // would desynchronise painted layout from measured layout. That is the
      // invariant. Three separate things are asserted for it, because the
      // obvious one is not enough on its own:
      //
      //  1. Painted height EQUALS the density token. This is the
      //     painted-vs-measured contract stated directly, and it is the one
      //     that can fail: @pretable/react writes `height: 52px` INLINE on the
      //     header row from the value it read, so no stylesheet can shrink it —
      //     but `min-height` outranks `height`, and a rule declaring one grows
      //     the painted box while the JS geometry carries on believing the
      //     token. Measured: `[data-pretable-header-row] { min-height: 80px }`
      //     takes the painted header 52 -> 80 with the inline `52px` untouched.
      //  2. Nothing paints outside that box. The failure a padding-based hit
      //     area would produce is not a taller header — the inline height pins
      //     that — it is a control SPILLING past it into the first data row.
      //     Measured: 60px of padding on the funnel put 40.5px of button below
      //     the header's bottom edge while every height reading stayed put.
      //  3. On/off in the same layout frame. `getBoundingClientRect` flushes
      //     style and layout synchronously and nothing here yields, so both
      //     readings describe one frame of one build rather than two builds
      //     whose fonts or scrollbars could differ for unrelated reasons.
      //     Necessary, and — because of (1) — nowhere near sufficient alone.
      const seen = await page.evaluate((scope) => {
        const q = (sel: string) => document.querySelector(`${scope} ${sel}`)!;
        const px = (v: number) => Math.round(v * 100) / 100;
        const read = () => {
          const headerRow = q(
            "[data-pretable-header-row]",
          ).getBoundingClientRect();
          const row = q("[data-pretable-row]").getBoundingClientRect();
          const spill = [
            "[data-pretable-filter-funnel]",
            "[data-pretable-column-menu-button]",
            "[data-pretable-header-cell]",
          ].map((sel) => {
            const box = q(sel).getBoundingClientRect();
            return {
              sel,
              below: px(box.bottom - headerRow.bottom),
              above: px(headerRow.top - box.top),
            };
          });
          return { header: px(headerRow.height), row: px(row.height), spill };
        };
        const on = read();
        // Everything this project adds, switched back off.
        const off = document.createElement("style");
        off.textContent = `
          [data-pretable-resize-handle] { display: block !important; }
          [data-pretable-filter-funnel] { opacity: 0 !important; }
          [data-pretable-filter-funnel]::after { content: none !important; }
          [data-pretable-column-menu-button]::after { content: none !important; }
        `;
        document.head.appendChild(off);
        const reverted = read();
        off.remove();
        const token = (name: string) =>
          getComputedStyle(document.documentElement)
            .getPropertyValue(name)
            .trim();
        return {
          on,
          off: reverted,
          tokens: {
            header: token("--pretable-header-height"),
            row: token("--pretable-row-height"),
          },
        };
      }, WITH_PANEL);
      const label = JSON.stringify(seen);

      // (1) painted == measured
      expect(`${seen.on.header}px`, label).toBe(seen.tokens.header);
      // The row token is a FLOOR, not a height — a row whose content is taller
      // is drawn taller. This fixture's content is well under every tier, which
      // is what makes equality the right assertion here rather than `>=`.
      expect(`${seen.on.row}px`, label).toBe(seen.tokens.row);

      // (2) nothing spills out of the header row
      for (const part of seen.on.spill) {
        expect(
          part.below,
          `${part.sel} spills below the header: ${label}`,
        ).toBeLessThanOrEqual(0);
        expect(
          part.above,
          `${part.sel} spills above the header: ${label}`,
        ).toBeLessThanOrEqual(0);
      }

      // (3) on/off, one frame
      expect(seen.on.header, label).toBe(seen.off.header);
      expect(seen.on.row, label).toBe(seen.off.row);
    });
  }

  test("re-spaces the two remaining slots off the trailing edge", async ({
    page,
  }) => {
    await gotoFixture(page, "standard");
    // With the strip gone there is 48px of trailing edge for two 24px targets.
    const offsets = await slotOffsets(page, WITH_PANEL, "alpha");
    expect(offsets, JSON.stringify(offsets)).toMatchObject({
      funnelSlot: { left: -24 },
      menuSlot: { left: -48 },
    });
  });
});

// ---------------------------------------------------------------------------
// Fine pointer — the control group
// ---------------------------------------------------------------------------

test.describe("fine pointer (desktop)", () => {
  test("keeps the header slot geometry byte-identical", async ({ page }) => {
    // This is the no-op proof for moving the offsets out of inline constants
    // and into custom properties. The numbers are the literals the inline
    // styles used to carry: the 4px strip hugging the trailing edge, the funnel
    // 22px back (immediately left of the strip), the menu 40px back
    // (immediately left of the funnel).
    await gotoFixture(page, "standard");
    const offsets = await slotOffsets(page, WITH_PANEL, "alpha");
    expect(offsets, JSON.stringify(offsets)).toEqual({
      resize: { left: -4, width: 4 },
      funnelSlot: { left: -22, width: 18 },
      menuSlot: { left: -40, width: 18 },
    });

    // ...and with no group panel, the funnel still sits at -22 and no menu slot
    // exists to shift it.
    const plain = await slotOffsets(page, NO_PANEL, "alpha");
    expect(plain, JSON.stringify(plain)).toEqual({
      resize: { left: -4, width: 4 },
      funnelSlot: { left: -22, width: 18 },
      menuSlot: null,
    });
  });

  test("keeps the funnel hover-revealed", async ({ page }) => {
    // The coarse rule must not leak: on a desktop the funnel is still invisible
    // until the header row is hovered.
    await gotoFixture(page, "standard");
    const funnel = page.locator(controls(NO_PANEL, "alpha").funnel);
    await expect(funnel).toHaveCSS("opacity", "0");
    await page.locator(`${NO_PANEL} [data-pretable-header-row]`).hover();
    await expect(funnel).toHaveCSS("opacity", "1");
  });

  test("still resizes a column by its strip", async ({ page }) => {
    // A removed control is not a broken control. With the strip gone on coarse
    // pointers, a test that only asserted its absence would pass just as well
    // if resizing were broken on every pointer — so prove the drag still works
    // where the strip survives.
    await gotoFixture(page, "standard");
    const header = page.locator(
      `${NO_PANEL} [data-pretable-header-cell][data-pretable-column-id="alpha"]`,
    );
    const handle = page.locator(controls(NO_PANEL, "alpha").resize);
    await waitForStablePosition(handle);
    const before = (await header.boundingBox())?.width ?? 0;
    expect(before).toBeGreaterThan(0);
    await dragResizeHandle(handle, 60);
    await expect
      .poll(async () => (await header.boundingBox())?.width ?? 0)
      .toBeGreaterThan(before + 20);
  });
});
