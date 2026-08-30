import { describe, expect, test } from "vitest";
import fs from "node:fs";
import path from "node:path";

const GRID_CSS = path.resolve(__dirname, "../../grid.css");
const THEMES_DIR = path.resolve(__dirname, "../../themes");

/** grid.css with every comment removed, so a rule quoted in prose cannot
 *  satisfy a guard that is looking for the rule itself. */
const strippedCss = () =>
  fs.readFileSync(GRID_CSS, "utf8").replace(/\/\*[\s\S]*?\*\//g, "");

/** The flat `selector { body }` split every section guard shares. Shallow by
 *  construction — grid.css nests exactly one level (`@layer`, `@media`), and
 *  the outer at-rules fall out as selectorless noise the predicates reject. */
const rulesSelecting = (css: string, match: (selector: string) => boolean) =>
  [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].filter((m) => match(m[1]));

/** The token names pretable.css declares — the contract a section may read
 *  from and must not add to. Same source the token contract test loads. */
const tokenContract = () => {
  const theme = fs
    .readFileSync(path.join(THEMES_DIR, "pretable.css"), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "");
  return new Set(
    [...theme.matchAll(/(--pretable-[a-z0-9-]+)\s*:/g)].map((m) => m[1]),
  );
};

describe("grid.css cascade contract", () => {
  test("grid.css declares @layer pretable", () => {
    const css = fs.readFileSync(GRID_CSS, "utf8");
    expect(css).toMatch(/@layer\s+pretable\s*\{/);
  });

  test("grid.css styles the cell editor, error, and pending states", () => {
    const css = fs.readFileSync(GRID_CSS, "utf8");
    expect(css).toMatch(/:where\(\.pretable-cell-editor\)/);
    expect(css).toMatch(/:where\(\[data-pretable-edit-error\]\)/);
    expect(css).toMatch(/:where\(\[data-pretable-number-editor\]\)/);
    expect(css).toMatch(/:where\(textarea\.pretable-cell-editor\)/);
    expect(css).toMatch(/data-pretable-bool-cell/);
    expect(css).toMatch(
      /:where\(button\[data-pretable-bool-cell\]\[aria-invalid="true"\]\)/,
    );
    expect(css).toMatch(/var\(--pretable-edit-bg\)/);
    expect(css).toMatch(/var\(--pretable-text-error\)/);
  });

  test("pinned header cells get an opaque background, both sides", () => {
    const css = fs.readFileSync(GRID_CSS, "utf8");
    // The header row's own background sits BEHIND its cells; a transparent
    // pinned header cell lets a scrolled-under header's label read through it.
    const rule = css.match(
      /:where\(\s*\[data-pretable-header-cell\]\[data-pretable-pinned="left"\],\s*\[data-pretable-header-cell\]\[data-pretable-pinned="right"\]\s*\)\s*\{[^}]*\}/,
    );
    expect(rule?.[0]).toMatch(/background:\s*var\(--pretable-bg-header\)/);
  });

  test("pinned body cells and group rows have their own surface tokens", () => {
    // They used to borrow --pretable-bg-header, which meant a theme could not
    // restyle a frozen data column without also restyling the header strip.
    const css = fs.readFileSync(GRID_CSS, "utf8");
    const pinnedBody = css.match(
      /:where\(\[data-pretable-cell\]\[data-pretable-pinned="left"\]\)\s*\{([\s\S]*?)\}/,
    )?.[1];
    expect(pinnedBody, "no left-pinned body rule").toBeDefined();
    expect(pinnedBody).toMatch(/background:\s*var\(--pretable-bg-pinned\)/);

    const groupRow = css.match(
      /:where\(\[data-pretable-group-row\] \[data-pretable-cell\]\)\s*\{([\s\S]*?)\}/,
    )?.[1];
    expect(groupRow, "no group-row rule").toBeDefined();
    expect(groupRow).toMatch(/background:\s*var\(--pretable-bg-group-row\)/);
  });

  test("the pinned seam is wired, mirrored, and outlives the group-row band", () => {
    // --pretable-seam-color had ZERO consumers before this: it was declared by
    // every theme and read by nothing, so a theme that dropped both the vertical
    // rule and the pinned tone step had no frozen-column boundary at all.
    // The right edge must MIRROR the left offset — that is why the token holds a
    // colour rather than a whole shadow, since one shadow value cannot be
    // reversed.
    const css = fs.readFileSync(GRID_CSS, "utf8");
    const left = css.match(
      /:where\(\[data-pretable-cell\]\[data-pretable-pinned="left"\]\)\s*\{([\s\S]*?)\}/,
    )?.[1];
    const right = css.match(
      /:where\(\[data-pretable-cell\]\[data-pretable-pinned="right"\]\)\s*\{([\s\S]*?)\}/,
    )?.[1];
    expect(left, "no left-pinned rule").toBeDefined();
    expect(right, "no right-pinned rule").toBeDefined();
    expect(left).toMatch(
      /box-shadow:\s*8px 0 8px -8px var\(--pretable-seam-color\)/,
    );
    expect(right).toMatch(
      /box-shadow:\s*-8px 0 8px -8px var\(--pretable-seam-color\)/,
    );

    // And a frozen column must not punch a notch through a group band: the
    // pinned rules follow the group-row rule at equal specificity, so the
    // restoring rule has to come after BOTH of them.
    const pinnedLeft = css.indexOf(
      '[data-pretable-cell][data-pretable-pinned="left"]',
    );
    const restore = css.indexOf(
      "[data-pretable-group-row] [data-pretable-cell][data-pretable-pinned]",
    );
    expect(restore, "no group-row pinned restore rule").toBeGreaterThan(-1);
    expect(
      restore,
      "restore rule must follow the pinned rules",
    ).toBeGreaterThan(pinnedLeft);
  });

  test("a focused cell draws its ring with `outline`, never `box-shadow`", () => {
    // Two reasons, both load-bearing:
    //
    // 1. The pinned seam is a `box-shadow` on the same element, and box-shadow
    //    is not additive across rules — the last one wins outright. A focus
    //    ring in that slot erases the frozen-column seam for as long as the
    //    cell holds focus, which is observable in the house theme (pretable.css
    //    draws a visible --pretable-seam-color; the two themes that shipped
    //    when the trade was first accepted both set it to `transparent`).
    // 2. Every other focus affordance in this stylesheet — twisty, group chip,
    //    menu item — is a 2px outline. A cell drawing an inset shadow instead
    //    is an inconsistency a consumer cannot restyle in one place.
    const css = fs
      .readFileSync(GRID_CSS, "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "");
    const focusRules = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].filter((m) =>
      m[1].includes('data-pretable-focused="true"'),
    );
    expect(focusRules.length, "no focused-cell rules at all").toBeGreaterThan(
      0,
    );
    for (const [, selector, body] of focusRules) {
      expect(
        body,
        `focus rule "${selector.trim()}" draws its ring with box-shadow, which collides with the pinned seam`,
      ).not.toMatch(/box-shadow:/);
    }
  });

  test("one rule rings a focused cell, and it covers ARIA-only cells", () => {
    // There used to be two: an `outline` keyed on [data-pretable-cell] and an
    // inset `box-shadow` keyed on [role="gridcell"]. @pretable/react puts BOTH
    // attributes on the same element, so every focused cell drew two rings.
    // Collapsing them must not drop the ARIA arm — a custom renderer that emits
    // the ARIA grid pattern without pretable's data attributes still gets the
    // fill from the aria-selected rule, and must still get the ring.
    const css = fs
      .readFileSync(GRID_CSS, "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "");
    const focusRules = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].filter(
      (m) =>
        m[1].includes('data-pretable-focused="true"') &&
        /outline:/.test(m[2]) &&
        !m[1].includes("data-pretable-row"),
    );
    expect(
      focusRules.length,
      `expected exactly one cell focus-ring rule, found ${focusRules.length}`,
    ).toBe(1);
    const selector = focusRules[0][1];
    expect(selector).toContain(
      '[data-pretable-cell][data-pretable-focused="true"]',
    );
    expect(selector).toContain(
      '[role="gridcell"][data-pretable-focused="true"]',
    );
  });

  test("row hover is declared after the pinned surfaces so it reaches them", () => {
    // Everything here is :where()-flattened to (0,0,0), so source order is the
    // only cascade lever. Declared before the pinned rules, hover loses on
    // pinned cells and a hovered row visibly breaks in half at the frozen edge.
    const css = fs.readFileSync(GRID_CSS, "utf8");
    const pinned = css.indexOf(
      '[data-pretable-cell][data-pretable-pinned="left"]',
    );
    const hover = css.indexOf("[data-pretable-row]:hover [data-pretable-cell]");
    expect(pinned, "no pinned rule").toBeGreaterThan(-1);
    expect(hover, "no hover rule").toBeGreaterThan(-1);
    expect(hover, "hover must come after the pinned surfaces").toBeGreaterThan(
      pinned,
    );
  });

  test("header cells reset the button border before drawing the tokenized divider", () => {
    const css = fs.readFileSync(GRID_CSS, "utf8");
    const rule = css.match(
      /:where\(\[data-pretable-header-cell\]\)\s*\{([\s\S]*?)\}/,
    )?.[1];
    expect(rule, "no [data-pretable-header-cell] rule found").toBeDefined();
    expect(rule).toMatch(
      /border:\s*0;[\s\S]*border-right:\s*var\(--pretable-rule-width,\s*1px\)\s*solid\s*var\(--pretable-rule-vertical,\s*var\(--pretable-rule\)\)/,
    );
  });

  test("the row hairline and the column divider read different tokens", () => {
    // The whole point of the split: a theme must be able to drop the vertical
    // cage without also erasing row separation. If both axes resolve to the
    // same token again, that capability is silently gone. The fallback chain
    // on the vertical declarations (`--pretable-rule-vertical, var(--pretable-rule)`)
    // is deliberate — a theme predating the axis split still needs to fall
    // back to `--pretable-rule`, not to no vertical token at all — so this
    // regex checks for the vertical TOKEN NAME appearing at all, which a
    // collapsed-axis edit (deleting `-vertical` and reusing `--pretable-rule`
    // outright) would fail.
    const css = fs.readFileSync(GRID_CSS, "utf8");
    const cellRule = css.match(
      /:where\(\[data-pretable-cell\]\)\s*\{([\s\S]*?)\}/,
    )?.[1];
    expect(cellRule, "no [data-pretable-cell] rule found").toBeDefined();
    expect(cellRule).toMatch(
      /border-right:\s*var\(--pretable-rule-width,\s*1px\)\s*solid\s*var\(--pretable-rule-vertical,\s*var\(--pretable-rule\)\)/,
    );
    expect(cellRule).toMatch(
      /border-bottom:\s*var\(--pretable-rule-width,\s*1px\)\s*solid\s*var\(--pretable-rule\);/,
    );
  });

  test("header cells take their text color from the header token", () => {
    // The surface renders header cells as <button>, which carries a UA color.
    // The skin owns the reset, so this rule is the only thing standing between
    // `--pretable-text-header` and a header that renders in buttontext.
    const css = fs.readFileSync(GRID_CSS, "utf8");
    const rule = css.match(
      /:where\(\[data-pretable-header-cell\]\)\s*\{([\s\S]*?)\}/,
    )?.[1];
    expect(rule, "no [data-pretable-header-cell] rule found").toBeDefined();
    expect(rule).toMatch(/color:\s*var\(--pretable-text-header\)/);
  });

  test("header cells reset the UA button background", () => {
    // Header cells are <button> (pretable-surface.tsx). Without this reset the
    // UA ButtonFace fill paints, and the grid only looks right in apps that
    // happen to ship a reset — both of ours import Tailwind Preflight, which is
    // why this went unnoticed. Every other button in the file resets explicitly.
    const css = fs.readFileSync(GRID_CSS, "utf8");
    const rule = css.match(
      /:where\(\[data-pretable-header-cell\]\)\s*\{([\s\S]*?)\}/,
    )?.[1];
    expect(rule, "no [data-pretable-header-cell] rule found").toBeDefined();
    expect(rule).toMatch(/background:\s*transparent/);
  });

  test("small controls use the control radius, surfaces use the card radius", () => {
    const css = fs.readFileSync(GRID_CSS, "utf8");
    const funnel = css.match(
      /:where\(\[data-pretable-filter-funnel\]\)\s*\{([\s\S]*?)\}/,
    )?.[1];
    expect(funnel).toMatch(/border-radius:\s*var\(--pretable-radius-control\)/);
    const viewport = css.match(
      /:where\(\[data-pretable-scroll-viewport\]\)\s*\{([\s\S]*?)\}/,
    )?.[1];
    expect(viewport).toMatch(/border-radius:\s*var\(--pretable-radius\)/);
  });

  test("grid.css styles the enum combobox listbox", () => {
    const css = fs.readFileSync(GRID_CSS, "utf8");
    expect(css).toMatch(/:where\(\[data-pretable-enum-listbox\]\)/);
    expect(css).toMatch(
      /:where\(\[data-pretable-enum-option\]\[aria-selected="true"\]\)/,
    );
    // An empty result set must not paint a bare popover box.
    expect(css).toMatch(/:where\(\[data-pretable-enum-listbox\]:empty\)/);
  });

  test("grid.css styles the date calendar popover", () => {
    const css = fs.readFileSync(GRID_CSS, "utf8");
    expect(css).toMatch(/:where\(\[data-pretable-date-popover\]\)/);
    expect(css).toMatch(
      /:where\(\[data-pretable-date-day\]\[aria-selected="true"\]\)/,
    );
    expect(css).toMatch(
      /:where\(\[data-pretable-date-day\]\[data-pretable-date-today\]\)/,
    );
  });

  test("grid.css styles every element of the drag-to-group panel", () => {
    const css = fs.readFileSync(GRID_CSS, "utf8");
    // The panel's DOM is a fixed contract (@pretable/react emits exactly
    // these); an unstyled one of them ships as a naked <span> or <button>.
    for (const attr of [
      "data-pretable-group-panel",
      "data-pretable-group-panel-empty",
      "data-pretable-group-chip",
      "data-pretable-chip-handle",
      "data-pretable-chip-label",
      "data-pretable-chip-remove",
      "data-pretable-chip-drop-indicator",
    ]) {
      expect(css, `no rule for [${attr}]`).toMatch(
        new RegExp(`:where\\(\\[${attr}\\]`),
      );
    }
    // Drag feedback and the keyboard's focus ring are the two states the panel
    // is unusable without.
    expect(css).toMatch(
      /:where\(\[data-pretable-group-panel\]\[data-pretable-group-panel-active\]\)/,
    );
    expect(css).toMatch(
      /:where\(\[data-pretable-group-chip\]\[data-pretable-chip-dragging\]\)/,
    );
    const chipFocus = css.match(
      /:where\(\[data-pretable-group-chip\]:focus-visible\)\s*\{[^}]*\}/,
    );
    expect(chipFocus?.[0]).toMatch(/var\(--pretable-focus-ring\)/);
    // The strip's height is a token, not a literal — @pretable/react reads the
    // same one to subtract it from viewportHeight.
    const panel = css.match(
      /:where\(\[data-pretable-group-panel\]\)\s*\{[^}]*\}/,
    );
    expect(panel?.[0]).toMatch(/var\(--pretable-group-panel-height\)/);
  });

  test("the icon rule keeps a literal size fallback", () => {
    const css = fs.readFileSync(GRID_CSS, "utf8");
    const rule = css.match(/:where\(\[data-pretable-icon\]\)\s*\{[^}]*\}/)?.[0];
    expect(rule, "no [data-pretable-icon] rule found").toBeDefined();
    // An SVG with a viewBox and no width has no useful intrinsic size, so a
    // bare var() against a theme that predates the token computes to
    // `width: auto` — measured at 54px for the chip grip, which drags the
    // drag-to-group strip's height up with it. Same reasoning as
    // --pretable-group-indent.
    for (const axis of ["width", "height"]) {
      expect(rule, `${axis} has no literal fallback`).toMatch(
        new RegExp(`${axis}:\\s*var\\(--pretable-icon-size,\\s*\\d+px\\)`),
      );
    }
  });

  test("grid.css styles the column menu and its ⋮ button", () => {
    const css = fs.readFileSync(GRID_CSS, "utf8");
    expect(css).toMatch(/:where\(\[data-pretable-column-menu-button\]\)/);
    expect(css).toMatch(/:where\(\[data-pretable-column-menu\]\)/);
    expect(css).toMatch(/:where\(\[data-pretable-menu-item\]\)/);
    // The ⋮ hides with the funnel, but an OPEN menu must keep its button lit.
    expect(css).toMatch(
      /:where\(\[data-pretable-column-menu-button\]\[aria-expanded="true"\]\)/,
    );
  });

  test("portaled popovers declare the sans font themselves", () => {
    const css = fs.readFileSync(GRID_CSS, "utf8");
    // These render into document.body, so they can't inherit the font-family
    // declared on the scroll viewport.
    for (const block of [
      /:where\(\[data-pretable-filter-menu\]\)\s*\{[^}]*\}/,
      /:where\(\[data-pretable-enum-listbox\]\)\s*\{[^}]*\}/,
      /:where\(\[data-pretable-date-popover\]\)\s*\{[^}]*\}/,
      /:where\(\[data-pretable-column-menu\]\)\s*\{[^}]*\}/,
    ]) {
      const match = css.match(block);
      expect(match?.[0]).toMatch(/font-family:\s*var\(--pretable-font-sans\)/);
    }
  });

  test("body cells clip their own content instead of spilling into the next column", () => {
    const css = fs.readFileSync(GRID_CSS, "utf8");
    const cellRule = css.match(
      /:where\(\[data-pretable-cell\]\)\s*\{([\s\S]*?)\}/,
    )?.[1];
    expect(cellRule, "no [data-pretable-cell] rule found").toBeDefined();
    // Cells are absolutely positioned, so an unclipped long value renders on
    // top of its neighbour rather than being cut off at the column edge.
    expect(cellRule).toMatch(/overflow:\s*hidden/);
  });

  test("alignment uses justify-content, and the trailing edge is safe", () => {
    // Cells are flex containers (`display: flex`) and an unwrapped cell value is
    // an anonymous flex item, which `text-align` cannot move — only
    // `justify-content` can. And plain `flex-end` clips an over-wide value at
    // its LEADING edge under `overflow: hidden`, rendering 1,234,567 as a
    // legible, plausible, WRONG 34,567. `safe` falls back to start-alignment
    // rather than overflowing the start edge.
    const css = fs.readFileSync(GRID_CSS, "utf8");
    const rule = css.match(
      /:where\(\s*\[data-pretable-cell\]\[data-pretable-column-align="end"\][\s\S]*?\{([\s\S]*?)\}/,
    )?.[1];
    expect(rule, "no align=end rule found").toBeDefined();
    expect(rule).toMatch(/justify-content:\s*safe flex-end/);
    expect(rule).not.toMatch(/text-align/);
  });

  test("rows with a wrapped cell top-align so first lines share a baseline", () => {
    // Cells are `align-items: center`, which in a variable-height row makes every
    // cell centre independently and destroys the row's shared first baseline.
    const css = fs.readFileSync(GRID_CSS, "utf8");
    const rule = css.match(
      /:where\(\s*\[data-pretable-row\]:has\(\[data-pretable-wrap="true"\]\)\s+\[data-pretable-cell\]\s*\)\s*\{([\s\S]*?)\}/,
    )?.[1];
    expect(rule, "no wrapped-row alignment rule found").toBeDefined();
    expect(rule).toMatch(/align-items:\s*flex-start/);
  });

  test("wrapped-row alignment follows the row-selection rule in source order", () => {
    // Every selector in this file is :where()-flattened to (0,0,0), so source
    // order is the ONLY thing that lets the wrapped-row rule reach the checkbox
    // cell — the row-selection rule sets `align-items: center` on it. Move the
    // alignment rule above that one and the checkbox silently goes back to
    // floating in the middle of a three-line row while every other cell sits at
    // the top. Nothing else in the suite would notice.
    const css = fs.readFileSync(GRID_CSS, "utf8");
    const rowSelect = css.indexOf('[data-pretable-row-select-cell="true"]');
    const wrapAlign = css.indexOf(
      '[data-pretable-row]:has([data-pretable-wrap="true"]) [data-pretable-cell]',
    );
    expect(rowSelect, "row-selection rule not found").toBeGreaterThan(-1);
    expect(wrapAlign, "wrapped-row alignment rule not found").toBeGreaterThan(
      -1,
    );
    expect(
      wrapAlign,
      "wrapped-row alignment must come AFTER the row-selection rule",
    ).toBeGreaterThan(rowSelect);
  });

  test("numeric and date cells get tabular figures without changing family", () => {
    const css = fs.readFileSync(GRID_CSS, "utf8");
    expect(css).toMatch(/font-variant-numeric:\s*tabular-nums lining-nums/);
    // The old rule swapped in the mono stack, which put a typographic seam down
    // every numeric column. One family throughout; the numerals do the aligning.
    expect(css).not.toMatch(/data-pretable-numeric/);
  });

  test("the selected-cell rule sets color only, not background", () => {
    // @pretable/react sets `aria-selected` and `data-pretable-selected` from
    // the same condition, and :where([role="gridcell"][aria-selected="true"])
    // follows this rule at equal (0,0,0) specificity — so a `background` here
    // has never painted. The `color` line HAS: nothing else sets a color on a
    // selected cell.
    const css = fs.readFileSync(GRID_CSS, "utf8");
    const rule = css.match(
      /:where\(\[data-pretable-cell\]\[data-pretable-selected="true"\]\)\s*\{([\s\S]*?)\}/,
    )?.[1];
    expect(rule, "no selected-cell rule found").toBeDefined();
    expect(rule).toMatch(/color:\s*var\(--pretable-text-selected\)/);
    expect(rule).not.toMatch(/background/);
  });

  test("grid.css styles no element the surface cannot emit", () => {
    // [data-pretable-toolbar] and [data-pretable-status-bar] were styled from
    // day one and are emitted by nothing in @pretable/react — verified by grep
    // across every .ts/.tsx/.mdx in the repo. Dead skin invites consumers to
    // target a contract that does not exist.
    const css = fs.readFileSync(GRID_CSS, "utf8");
    expect(css).not.toMatch(/data-pretable-toolbar/);
    expect(css).not.toMatch(/data-pretable-status-bar/);
  });

  test("hover and selection tint the surface instead of replacing it", () => {
    // Both state fills are translucent in all three shipped themes — Excel
    // sets --pretable-bg-hover to `transparent` outright, and
    // --pretable-selection-bg is an 8% color-mix in Excel and Material and a
    // literal rgba at 10% light / 16% dark in pretable. Declared as the
    // `background` SHORTHAND these rules replace the surface fill the earlier
    // rules painted. Translucency is the load-bearing property, not the
    // color-mix: whichever form a theme writes it in, the shorthand loses the
    // opaque fill underneath. On a pinned cell
    // that is a real bug, not a cosmetic one: pinned cells are
    // `position: sticky; z-index: 1` with unpinned cells scrolling underneath,
    // so a hovered or selected pinned cell that loses its opaque fill lets the
    // scrolled-under column print straight through it. As a background-IMAGE
    // layer the state composes OVER the surface color instead.
    // Comments are stripped first so prose mentioning `background` can't satisfy
    // (or trip) these assertions.
    const css = fs
      .readFileSync(GRID_CSS, "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "");

    const hover = css.match(
      /:where\(\[data-pretable-row\]:hover \[data-pretable-cell\]\)\s*\{([\s\S]*?)\}/,
    )?.[1];
    expect(hover, "no hover rule").toBeDefined();
    expect(hover).toMatch(
      /background-image:\s*linear-gradient\(\s*var\(--pretable-bg-hover\),\s*var\(--pretable-bg-hover\),?\s*\)/,
    );
    expect(
      hover,
      "hover must not use the background shorthand: it resets background-color and makes sticky cells transparent",
    ).not.toMatch(/background:\s/);

    const selection = css.match(
      /:where\(\[role="gridcell"\]\[aria-selected="true"\]\)\s*\{([\s\S]*?)\}/,
    )?.[1];
    expect(selection, "no selection fill rule").toBeDefined();
    expect(selection).toMatch(
      /background-image:\s*linear-gradient\(\s*var\(--pretable-selection-bg\),\s*var\(--pretable-selection-bg\),?\s*\)/,
    );
    expect(
      selection,
      "selection must not use the background shorthand: same sticky-transparency failure as hover",
    ).not.toMatch(/background:\s/);
  });

  test("overlays read the elevation token, not the drag ghost's", () => {
    // Four of the five things that took --pretable-reorder-ghost-shadow are
    // popovers; only one was ever a drag ghost. The name is now what is lifted.
    const css = fs.readFileSync(GRID_CSS, "utf8");
    expect(css).not.toMatch(/reorder-ghost-shadow/);
    expect(css).toMatch(/box-shadow:\s*var\(--pretable-shadow-overlay\)/);
  });

  test("dark mode overrides the overlay shadow", () => {
    // A black shadow on a #1c1c1c surface is invisible; without an override
    // every dark-mode popover reads as flat.
    const css = fs.readFileSync(path.join(THEMES_DIR, "material.css"), "utf8");
    const dark = css.match(/\[data-theme="dark"\]\s*\{([\s\S]*?)\n\}/)?.[1];
    expect(dark, "no dark block").toBeDefined();
    expect(dark).toMatch(/--pretable-shadow-overlay:/);
  });

  test("the delta presentation carries direction by more than colour", () => {
    // Comments stripped first: this file's prose names ▲ and ▼ (explaining why
    // they are NOT used), which would otherwise satisfy the very check below.
    const css = fs
      .readFileSync(GRID_CSS, "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "");

    // Colour, from the ramp.
    expect(
      css.match(/:where\(\[data-pretable-delta="up"\]\)\s*\{([\s\S]*?)\}/)?.[1],
      "no delta=up rule",
    ).toMatch(/color:\s*var\(--pretable-positive\)/);
    expect(
      css.match(
        /:where\(\[data-pretable-delta="down"\]\)\s*\{([\s\S]*?)\}/,
      )?.[1],
      "no delta=down rule",
    ).toMatch(/color:\s*var\(--pretable-negative\)/);
    expect(
      css.match(
        /:where\(\[data-pretable-delta="flat"\]\)\s*\{([\s\S]*?)\}/,
      )?.[1],
      "no delta=flat rule",
    ).toMatch(/color:\s*var\(--pretable-text-dim\)/);

    // ...AND a marker, so direction survives greyscale, colour-blindness and a
    // printed page. Red/green is the worst possible pair for the commonest
    // deficiency, so colour alone would be no signal at all for those readers.
    // The marker is an element from the icon set emitted by PretableDelta —
    // cells.test.tsx asserts one appears per direction; grid.css's half of the
    // contract is sizing a slot for it.
    expect(css, "grid.css reserves no marker slot inside a delta").toMatch(
      /:where\(\[data-pretable-delta\] \[data-pretable-icon\]\)\s*\{/,
    );

    // And the marker must NOT be a font-rendered glyph. SP2b removed ▲ and ▼
    // from this grid because a text glyph re-renders in whatever font the
    // active theme picked — weight, size and baseline all move between Excel's
    // Aptos Narrow, Material's Roboto and pretable's own stack, and on most UI
    // stacks the characters are absent entirely and fall through to a platform
    // symbol font. No rule scoped to a delta may declare `content:`.
    const deltaRules = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].filter((m) =>
      m[1].includes("data-pretable-delta"),
    );
    expect(deltaRules.length, "no delta rules at all").toBeGreaterThan(0);
    for (const [, selector, body] of deltaRules) {
      expect(
        body,
        `delta rule "${selector.trim()}" declares generated text content; the direction marker is an element, not a font glyph`,
      ).not.toMatch(/content:/);
    }
  });

  test("the status presentation carries state by dot AND label", () => {
    const css = fs
      .readFileSync(GRID_CSS, "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "");

    const base = css.match(
      /:where\(\[data-pretable-status\]\)\s*\{([\s\S]*?)\}/,
    )?.[1];
    expect(base, "no status rule").toBeDefined();
    // The label is the signal that survives greyscale, so it must render in the
    // ordinary cell ink — tint it and the state is back to being colour alone.
    expect(base).toMatch(/color:\s*var\(--pretable-text-cell\)/);

    const dot = css.match(
      /:where\(\[data-pretable-status\]\)::before\s*\{([\s\S]*?)\}/,
    )?.[1];
    expect(dot, "no status dot rule").toBeDefined();
    // Empty content: the dot is a shape, not invented text. That is also why it
    // is allowed to be generated content when the delta's marker is not — a
    // border-radius box has no font to re-render in.
    expect(dot).toMatch(/content:\s*""/);
    expect(dot).toMatch(/border-radius:\s*50%/);
    expect(dot).toMatch(/background:\s*var\(--pretable-text-dim\)/);

    for (const tone of ["positive", "negative", "warning", "info"]) {
      const rule = css.match(
        new RegExp(
          `:where\\(\\[data-pretable-status="${tone}"\\]\\)::before\\s*\\{([\\s\\S]*?)\\}`,
        ),
      )?.[1];
      expect(rule, `no status=${tone} rule`).toBeDefined();
      expect(rule).toMatch(
        new RegExp(`background:\\s*var\\(--pretable-${tone}\\)`),
      );
    }
  });

  test("the badge is a hairline chip and never tints its own fill", () => {
    // A tinted chip cannot pass AA. Tinting the fill with the text's own hue
    // costs ~0.6 of contrast against this ramp: 4.38/4.13/4.32/4.49 at a 10%
    // tint over white, and worse the deeper it goes — every one of them under
    // 4.5. The website's hand-rolled pills shipped at 14% (3.89–4.24), which is
    // the failure this rule exists to replace. So the fill stays the grid
    // surface, the boundary is a hairline (--pretable-rule-strong is 4.00:1 on
    // pretable's white grid and only owes 3:1 as a UI boundary), and TONE RIDES
    // THE TEXT, where what it measures depends on the ground the chip inherits:
    // 4.83–5.17 on a white grid surface (pretable, Excel), 4.71–5.04 on
    // Material's #fcfcfc. The assertions below read none of these numbers —
    // they pin the structure, and the numbers are why the structure is this.
    const css = fs
      .readFileSync(GRID_CSS, "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "");

    const base = css.match(
      /:where\(\[data-pretable-badge\]\)\s*\{([\s\S]*?)\}/,
    )?.[1];
    expect(base, "no badge rule").toBeDefined();
    expect(base).toMatch(/border:\s*1px solid var\(--pretable-rule-strong\)/);
    expect(base).toMatch(/background:\s*var\(--pretable-bg-grid\)/);
    expect(base).toMatch(/color:\s*var\(--pretable-text-cell\)/);

    for (const tone of ["positive", "negative", "warning", "info"]) {
      const rule = css.match(
        new RegExp(
          `:where\\(\\[data-pretable-badge\\]\\[data-pretable-tone="${tone}"\\]\\)\\s*\\{([\\s\\S]*?)\\}`,
        ),
      )?.[1];
      expect(rule, `no badge tone=${tone} rule`).toBeDefined();
      expect(rule).toMatch(new RegExp(`color:\\s*var\\(--pretable-${tone}\\)`));
    }

    // The load-bearing half: NO rule scoped to a badge may fill from the ramp,
    // by any spelling. A `color-mix` of the tone into the surface is exactly
    // the shape of the failure, and it is what a later hand looking to make the
    // chips "read louder" would reach for first.
    const badgeRules = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].filter((m) =>
      m[1].includes("data-pretable-badge"),
    );
    expect(badgeRules.length, "no badge rules at all").toBeGreaterThan(0);
    for (const [, selector, body] of badgeRules) {
      expect(
        body,
        `badge rule "${selector.trim()}" tints its fill from the semantic ramp; every tint drops the chip below 4.5:1`,
      ).not.toMatch(
        /background[^;]*var\(--pretable-(positive|negative|warning|info)\)/,
      );
      expect(
        body,
        `badge rule "${selector.trim()}" mixes a fill; the badge's fill is the grid surface, untinted`,
      ).not.toMatch(/background[^;]*color-mix/);
    }

    // The dot a TONED badge carries, which nothing asserted until now — and the
    // docs page describes it, so deleting this rule silently made that page
    // wrong. It exists because dropping the tinted fill above fixed the
    // contrast but left tone readable only by reading the label; the dot puts
    // it back as shape, so scanning a column is spotting again.
    const dot = css.match(
      /:where\(\[data-pretable-badge\]\[data-pretable-tone\]\)::before\s*\{([\s\S]*?)\}/,
    )?.[1];
    expect(
      dot,
      "no toned-badge ::before rule. The dot is the only tone channel that " +
        "survives peripheral vision, and `grid/cell-presentations.mdx` tells " +
        "readers it is there.",
    ).toBeDefined();
    expect(dot).toMatch(/content:\s*""/);
    // `currentColor`, not a per-tone background: that is what makes the dot
    // track the label's tone with no rule per tone, and it is the claim the
    // docs page makes about greyscale (same hue as the label, so the label is
    // still what separates one tone from another).
    expect(dot).toMatch(/background:\s*currentColor/);

    // Not also asserting the pseudo-element stays outside :where() — the
    // "no pseudo-element inside :where()" test below already covers every rule
    // in the file, and it fires on this one. A second copy here would be a
    // check with nothing of its own to catch.
  });

  test("the entity's secondary line is dimmed by a token, never by opacity", () => {
    // Every hand-rolled version of this pattern reached for opacity and every
    // one of them failed AA: the website's Day P&L percentage rendered 2.27:1
    // and its `.symbolSub` company name 3.88:1, both from an `opacity` on
    // otherwise-compliant ink. Opacity cannot reach 4.5:1 and still read as
    // secondary, so the subordination is carried by a token that was computed
    // (--pretable-text-dim, 7.72:1 on the grid) plus type size.
    const css = fs
      .readFileSync(GRID_CSS, "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "");

    const container = css.match(
      /:where\(\[data-pretable-entity\]\)\s*\{([\s\S]*?)\}/,
    )?.[1];
    expect(container, "no entity rule").toBeDefined();
    expect(container).toMatch(/flex-direction:\s*column/);

    const primary = css.match(
      /:where\(\[data-pretable-entity-primary\]\)\s*\{([\s\S]*?)\}/,
    )?.[1];
    expect(primary, "no entity primary rule").toBeDefined();
    // Both lines are in a fixed-width, `overflow: hidden` cell, so an
    // un-ellipsised long name is simply chopped mid-glyph at the column edge.
    expect(primary).toMatch(/text-overflow:\s*ellipsis/);

    const secondary = css.match(
      /:where\(\[data-pretable-entity-secondary\]\)\s*\{([\s\S]*?)\}/,
    )?.[1];
    expect(secondary, "no entity secondary rule").toBeDefined();
    expect(secondary).toMatch(/color:\s*var\(--pretable-text-dim\)/);
    expect(secondary).toMatch(/text-overflow:\s*ellipsis/);

    const entityRules = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].filter((m) =>
      m[1].includes("data-pretable-entity"),
    );
    expect(entityRules.length, "no entity rules at all").toBeGreaterThan(0);
    for (const [, selector, body] of entityRules) {
      expect(
        body,
        `entity rule "${selector.trim()}" dims with opacity; the secondary line takes --pretable-text-dim, which was computed against the surface`,
      ).not.toMatch(/opacity:/);
    }
  });

  describe("tool panel (SP1)", () => {
    const stripped = strippedCss;
    const toolRules = (css: string) =>
      rulesSelecting(css, (sel) => sel.includes("data-pretable-tool-"));

    test("the layout wrapper takes the card chrome and the viewport inside surrenders its own", () => {
      // With the panel on by default, the surface's outer box is the
      // `[data-pretable-tool-layout]` row. The card border/radius/shadow have
      // to move UP onto it — otherwise the rail docks visibly OUTSIDE the
      // card's frame — and the viewport must stop drawing its own copy or
      // every edge inside the card doubles.
      const css = stripped();
      const layout = css.match(
        /:where\(\[data-pretable-tool-layout\]\)\s*\{([\s\S]*?)\}/,
      )?.[1];
      expect(layout, "no [data-pretable-tool-layout] rule").toBeDefined();
      expect(layout).toMatch(
        /border:\s*1px solid var\(--pretable-rule-strong\)/,
      );
      expect(layout).toMatch(/border-radius:\s*var\(--pretable-radius\)/);
      expect(layout).toMatch(/box-shadow:\s*var\(--pretable-shadow-card\)/);
      // The wrapper clips its square-cornered children to its own radius;
      // without it every child's corner pokes through the rounded frame.
      expect(layout).toMatch(/overflow:\s*hidden/);

      const viewportInside = css.match(
        /:where\(\[data-pretable-tool-layout\]\)\s*:where\(\[data-pretable-scroll-viewport\]\)\s*\{([\s\S]*?)\}/,
      )?.[1];
      expect(
        viewportInside,
        "no rule stripping the viewport's chrome inside the layout wrapper",
      ).toBeDefined();
      expect(viewportInside).toMatch(/border:\s*0/);
      // Square corners on the inner viewport — the wrapper's radius does the
      // rounding; a kept radius draws a hairline sliver at every card corner.
      expect(viewportInside).toMatch(/border-radius:\s*0/);
      expect(viewportInside).toMatch(/box-shadow:\s*none/);
    });

    test("the group panel and error strip surrender their frame inside the wrapper and redraw the seam as a bottom border", () => {
      // Outside the wrapper those boxes draw their own border and rely on the
      // viewport's top border for the seam beneath them. Inside it the
      // viewport's border is gone, so without this rule the seam vanishes —
      // and their own side/top borders would double against the wrapper's
      // frame. One rule does both: zero the frame, redraw the seam as
      // border-bottom.
      const css = stripped();
      const surrender = css.match(
        /:where\(\[data-pretable-tool-layout\]\)\s*:where\(\[data-pretable-group-panel\]\),\s*:where\(\[data-pretable-tool-layout\]\)\s*:where\(\[data-pretable-body-state="error-strip"\]\)\s*\{([\s\S]*?)\}/,
      )?.[1];
      expect(
        surrender,
        "no rule surrendering the group panel's / error strip's frame inside the layout wrapper",
      ).toBeDefined();
      expect(surrender).toMatch(/border:\s*0/);
      expect(surrender).toMatch(/border-radius:\s*0/);
      expect(surrender).toMatch(
        /border-bottom:\s*1px solid var\(--pretable-rule-strong\)/,
      );
    });

    test("the rail borrows the header's surface and the pane the toolbar's", () => {
      // The panel is CHROME, not content: the rail sits on the same plane as
      // the header strip and the pane on the toolbar's. If either falls back
      // to the grid surface it reads as a data region with buttons in it.
      const css = stripped();
      const rail = css.match(
        /:where\(\[data-pretable-tool-rail\]\)\s*\{([\s\S]*?)\}/,
      )?.[1];
      expect(rail, "no [data-pretable-tool-rail] rule").toBeDefined();
      expect(rail).toMatch(/background:\s*var\(--pretable-bg-header\)/);

      const pane = css.match(
        /:where\(\[data-pretable-tool-pane\]\)\s*\{([\s\S]*?)\}/,
      )?.[1];
      expect(pane, "no [data-pretable-tool-pane] rule").toBeDefined();
      expect(pane).toMatch(/background:\s*var\(--pretable-bg-toolbar\)/);
    });

    test("tool-panel rules read only tokens the theme contract declares", () => {
      // The panel must not smuggle a new --pretable-* name past the 50-token
      // contract: a var() that no theme declares resolves to nothing, and the
      // contract test only proves that names RESOLVE — an element-scoped
      // invention (`--pretable-tool-width: 264px` declared and read in the
      // same section) would resolve and still be a token no theme owns.
      // The contract here is what pretable.css declares, the same source the
      // token contract test loads.
      const contract = tokenContract();
      expect(contract.size, "pretable.css declares no tokens?").toBeGreaterThan(
        20,
      );

      const rules = toolRules(stripped());
      expect(rules.length, "no tool-panel rules at all").toBeGreaterThan(0);
      for (const [, selector, body] of rules) {
        for (const [, name] of body.matchAll(/var\(\s*(--[a-zA-Z0-9-]+)/g)) {
          expect(
            contract.has(name),
            `tool-panel rule "${selector.trim()}" reads ${name}, which is outside the token contract`,
          ).toBe(true);
        }
        expect(
          body,
          `tool-panel rule "${selector.trim()}" declares a custom property; the panel adds no tokens`,
        ).not.toMatch(/--[a-zA-Z0-9-]+\s*:/);
      }
    });

    test("a hidden column dims by token, and nothing in the panel dims by opacity", () => {
      // The entity-secondary precedent, verbatim: every opacity-dimmed
      // secondary this repo has shipped failed WCAG AA, because opacity
      // multiplies away a contrast that --pretable-text-dim holds by
      // construction. The ban covers the whole section, not just the hidden
      // row — a faded row is also a dimmed label, and dimmed-by-fade is the
      // presentation a hidden column owns.
      const css = stripped();
      const hidden = css.match(
        /:where\(\s*\[data-pretable-tool-column-row\]\[data-pretable-column-hidden="true"\]\s*\)\s*\{([\s\S]*?)\}/,
      )?.[1];
      expect(hidden, "no hidden-column row rule").toBeDefined();
      expect(hidden).toMatch(/color:\s*var\(--pretable-text-dim\)/);

      for (const [, selector, body] of toolRules(css)) {
        expect(
          body,
          `tool-panel rule "${selector.trim()}" uses opacity; dim by --pretable-text-dim instead`,
        ).not.toMatch(/opacity:/);
      }
    });

    test("the selected tab swaps its surface without the background shorthand", () => {
      // The selected rule FOLLOWS the hover rule at equal (0,0,0)
      // specificity, and the `background` shorthand resets background-image
      // to `none` — so hovering the open tab would show no tint, on exactly
      // the tab a pointer rests on most. Same hazard the selection-fill
      // rules document at the top of grid.css.
      const css = stripped();
      const rule = css.match(
        /:where\(\[data-pretable-tool-tab\]\[aria-selected="true"\]\)\s*\{([\s\S]*?)\}/,
      )?.[1];
      expect(rule, "no selected-tab rule").toBeDefined();
      expect(rule).toMatch(/background-color:\s*var\(--pretable-bg-toolbar\)/);
      expect(
        rule,
        "the background shorthand resets background-image and erases the hover tint",
      ).not.toMatch(/background:\s/);
    });

    test("grid.css styles every element of the shell and columns section", () => {
      // Same shape as the drag-to-group panel's guard: the DOM is a fixed
      // contract the React task will emit, and an unstyled member ships as a
      // naked <span> or <button>.
      const css = stripped();
      for (const attr of [
        "data-pretable-tool-rail",
        "data-pretable-tool-tab",
        "data-pretable-tool-pane",
        "data-pretable-tool-section",
        "data-pretable-tool-search",
        "data-pretable-tool-reset",
        "data-pretable-tool-group-label",
        "data-pretable-tool-column-row",
        "data-pretable-tool-row-grip",
        "data-pretable-tool-column-label",
        "data-pretable-tool-row-menu-button",
        "data-pretable-tool-drop-indicator",
      ]) {
        expect(css, `no rule for [${attr}]`).toMatch(
          new RegExp(`:where\\(\\s*\\[${attr}\\]`),
        );
      }
      // The visibility checkbox is the grid's own checkbox control, enrolled
      // in the row-select rules so the panel and the selection column cannot
      // drift apart.
      expect(
        css,
        "no rule for button[data-pretable-tool-column-toggle]",
      ).toMatch(/button\[data-pretable-tool-column-toggle\]/);
      // The states the panel is unusable without: an open tab, a keyboard
      // ring on tabs and rows, and drag feedback.
      expect(css, "no selected-tab rule").toMatch(
        /:where\(\[data-pretable-tool-tab\]\[aria-selected="true"\]\)/,
      );
      expect(css, "no tab focus-ring rule").toMatch(
        /:where\(\[data-pretable-tool-tab\]:focus-visible\)/,
      );
      // List-tolerant since the grouping section enrolled its rows in the
      // same rule — anchored to the head of a :where() so a stray mention
      // elsewhere cannot satisfy it. The pinned selector must stay the HEAD
      // of the list; append new members after it.
      expect(css, "no row focus-ring rule").toMatch(
        /:where\(\s*\[data-pretable-tool-column-row\]:focus-visible[,\s)]/,
      );
      // List-tolerant tail for the same reason as the focus ring above.
      expect(css, "no dragging-row rule").toMatch(
        /:where\(\s*\[data-pretable-tool-column-row\]\[data-pretable-tool-row-dragging\][,\s)]/,
      );
    });
  });

  describe("filter builder (SP2b)", () => {
    // The attributes the DOM-contract guard enumerates. This list is for
    // COVERAGE only — what must exist. What the opacity and token guards
    // POLICE is the whole `data-pretable-filter-` prefix minus the legacy
    // names below, so a builder attribute added by a later task is guarded
    // the day it appears rather than the day someone remembers to list it.
    const BUILDER_ATTRS = [
      "data-pretable-filter-rail",
      "data-pretable-filter-row",
      "data-pretable-filter-join",
      "data-pretable-filter-add",
      "data-pretable-filter-empty",
      "data-pretable-filter-column-hidden",
      "data-pretable-filter-column-grouped",
      "data-pretable-filter-row-column",
      "data-pretable-filter-row-operator",
      "data-pretable-filter-row-value",
      "data-pretable-filter-row-remove",
    ];
    // The header funnel family predates the builder and shares its prefix:
    // `[data-pretable-filter-funnel]`'s hover-reveal is a deliberate
    // `opacity: 0/1` (it reveals a control, it does not dim one), and its
    // menu, chip, clear and active-state rules are the popover's, not the
    // panel's. Exempt by NAME, so the exemption is a closed list and
    // everything else under the prefix is policed by default.
    const LEGACY_FILTER_ATTRS =
      /data-pretable-filter-(?:funnel|menu|set|clear|active)(?![a-z0-9-])/g;
    const builderRules = (css: string) =>
      rulesSelecting(css, (sel) =>
        sel.replace(LEGACY_FILTER_ATTRS, "").includes("data-pretable-filter-"),
      );

    test("the rail draws the nesting cue as a border-inline-start rule", () => {
      // THE decision this guard protects: nesting is an indented run behind
      // a vertical hairline, not a bordered card. The difference the guard
      // defends is VISUAL, not arithmetic — a `border` shorthand here costs
      // only a pixel or two more, but it paints a BOX around every group,
      // which is precisely the treatment the indent-and-hairline decision
      // replaced. (The ~14px a level the CSS cites is a real card: border
      // plus padding on both sides.)
      const css = strippedCss();
      const rail = css.match(
        /:where\(\[data-pretable-filter-rail\]\)\s*\{([\s\S]*?)\}/,
      )?.[1];
      expect(rail, "no [data-pretable-filter-rail] rule").toBeDefined();
      expect(
        rail,
        "the rail's indent must be drawn by border-inline-start in --pretable-rule; it IS the nesting cue",
      ).toMatch(/border-inline-start:[^;]*var\(--pretable-rule\)/);
      // An indent with no inline padding puts the rows on top of the rule.
      expect(rail).toMatch(/padding-inline-start:/);
      // Having a hairline is not the same as not being a card: a full
      // `border` shorthand ALONGSIDE the inline-start rule satisfies every
      // assertion above while drawing the boxed group this section rejected.
      // Only a `border-*` longhand belongs here.
      expect(
        rail,
        "the rail must not also draw a full border; that is the card this section rejected",
      ).not.toMatch(/border:\s/);
    });

    test("a filtered hidden column dims by token, and nothing in the builder dims by opacity", () => {
      // The entity-secondary precedent again: --pretable-text-dim holds a
      // contrast computed against the surface, and an opacity multiplies it
      // away below AA. Every hand-rolled secondary in this repo has shipped
      // that failure at least once.
      const css = strippedCss();
      const hidden = css.match(
        /:where\(\s*\[data-pretable-filter-row\]\[data-pretable-filter-column-hidden="true"\]\s*\)\s*\{([\s\S]*?)\}/,
      )?.[1];
      expect(hidden, "no hidden-column filter row rule").toBeDefined();
      expect(hidden).toMatch(/color:\s*var\(--pretable-text-dim\)/);

      // The grouped-away marking (SP3b) dims by the same token, in a rule of
      // its own.
      const grouped = css.match(
        /:where\(\s*\[data-pretable-filter-row\]\[data-pretable-filter-column-grouped="true"\]\s*\)\s*\{([\s\S]*?)\}/,
      )?.[1];
      expect(grouped, "no grouped-away filter row rule").toBeDefined();
      expect(grouped).toMatch(/color:\s*var\(--pretable-text-dim\)/);

      const rules = builderRules(css);
      expect(rules.length, "no filter-builder rules at all").toBeGreaterThan(0);
      for (const [, selector, body] of rules) {
        expect(
          body,
          `filter-builder rule "${selector.trim()}" uses opacity; dim by --pretable-text-dim instead — or, if this is a funnel-family hover-reveal rather than a builder control, add its attribute to LEGACY_FILTER_ATTRS`,
        ).not.toMatch(/opacity:/);
      }
    });

    test("filter-builder rules read only tokens the theme contract declares", () => {
      // Same trap the tool panel's guard closes: a var() no theme declares
      // resolves to nothing, and an element-scoped invention (declared and
      // read inside this section) would resolve and still be a token no theme
      // owns. The builder adds no tokens.
      const contract = tokenContract();
      expect(contract.size, "pretable.css declares no tokens?").toBeGreaterThan(
        20,
      );
      const rules = builderRules(strippedCss());
      expect(rules.length, "no filter-builder rules at all").toBeGreaterThan(0);
      for (const [, selector, body] of rules) {
        for (const [, name] of body.matchAll(/var\(\s*(--[a-zA-Z0-9-]+)/g)) {
          expect(
            contract.has(name),
            `filter-builder rule "${selector.trim()}" reads ${name}, which is outside the token contract`,
          ).toBe(true);
        }
        expect(
          body,
          `filter-builder rule "${selector.trim()}" declares a custom property; the builder adds no tokens`,
        ).not.toMatch(/--[a-zA-Z0-9-]+\s*:/);
      }
    });

    test("grid.css styles every element of the filter builder's DOM contract", () => {
      // These attributes are the contract Tasks 3-5 emit. An unstyled member
      // ships as a naked <button> in the pane — the drag-to-group panel's
      // guard exists for the same reason.
      const css = strippedCss();
      // Every member but two: `data-pretable-filter-column-hidden` and
      // `data-pretable-filter-column-grouped` are STATES on a row, never
      // elements of their own, so they are checked by the dim-row guard
      // above and would only ever be found here as part of the compound
      // selectors that test already pins. They stay in the list because the
      // opacity and token guards read them as builder attributes.
      for (const attr of BUILDER_ATTRS.filter(
        (a) =>
          a !== "data-pretable-filter-column-hidden" &&
          a !== "data-pretable-filter-column-grouped",
      )) {
        // Anywhere inside the `:where(...)` list, not only at its head: the
        // leaf row's three fields share ONE box and therefore one grouped
        // selector, so a head-anchored match would demand a rule per
        // attribute — i.e. demand the duplication the shared rule avoids.
        // Still anchored to a :where(), so a rule outside the file's flat
        // (0,0,0) cascade cannot satisfy it.
        expect(css, `no rule for [${attr}]`).toMatch(
          new RegExp(`:where\\([^{)]*\\[${attr}\\]`),
        );
      }
      // The join is a <button> in a narrow pane, so it carries a real hit
      // target in its own rule rather than borrowing one from the
      // coarse-pointer block: WCAG 2.5.8 applies to the mouse here too, and
      // the label is the whole target.
      expect(css, "no join-control button rule").toMatch(
        /:where\(button\[data-pretable-filter-join\]\)/,
      );
      // The size sits on the shared rule the button also matches — every
      // selector here is (0,0,0)-flat, so the button gets it verbatim.
      const join = css.match(
        /:where\(\[data-pretable-filter-join\]\)\s*\{([\s\S]*?)\}/,
      )?.[1];
      expect(join, "no join-control base rule").toBeDefined();
      expect(join).toMatch(/block-size:\s*24px/);
      expect(join).toMatch(/min-inline-size:\s*(2[4-9]|[3-9]\d|\d{3,})px/);
      // Focus is an OUTLINE, never a box-shadow: the shadow slot is spent on
      // elevation, and a control that grows one loses its ring.
      expect(css, "no join focus ring").toMatch(
        /:where\(\[data-pretable-filter-join\]:focus-visible\)\s*\{[^}]*outline:/,
      );
      // The depth-64 refusal is a DISABLED add button, and disabled dims by
      // token like everything else here.
      // List-tolerant: `+ Add group` and the grouping section's expansion
      // pair ride the same rule (grid.css extends the list in place).
      expect(css, "no disabled state for the add actions").toMatch(
        /:where\(\s*\[data-pretable-filter-add\]:disabled[,\s)]/,
      );
      // The add actions carry the same explicit WCAG 2.5.8 claim the join
      // does, so they get the same guard: 24px, in the base rule, on every
      // pointer.
      const add = css.match(
        /:where\(\s*\[data-pretable-filter-add\][^{]*\)\s*\{([\s\S]*?)\}/,
      )?.[1];
      expect(add, "no add-action rule").toBeDefined();
      expect(add).toMatch(/block-size:\s*24px/);

      // The leaf row's remove button, on BOTH axes. It is the one control here
      // with a real alternative already in the file — `[data-pretable-chip-
      // remove]`, which is 14x14 — so the guard states the size rather than
      // trusting that nobody reaches for the drop-in. 24px is WCAG 2.5.8's
      // minimum and the height every other control in this section took.
      const remove = css.match(
        /:where\(\s*\[data-pretable-filter-row-remove\][^{]*\)\s*\{([\s\S]*?)\}/,
      )?.[1];
      expect(remove, "no leaf-row remove-button rule").toBeDefined();
      expect(
        remove,
        "the remove button must be at least 24px tall (WCAG 2.5.8); the 14px chip remove is not a drop-in here",
      ).toMatch(/block-size:\s*(2[4-9]|[3-9]\d|\d{3,})px/);
      expect(
        remove,
        "the remove button must be at least 24px wide (WCAG 2.5.8); it holds a glyph, so nothing else gives it width",
      ).toMatch(/inline-size:\s*(2[4-9]|[3-9]\d|\d{3,})px/);
      // A border that lands outside a content-box host makes the 24 a 26 and
      // breaks the alignment the join's rule argues for one section down.
      expect(remove).toMatch(/box-sizing:\s*border-box/);
    });

    test("the leaf row's fields can shrink inside the pane", () => {
      // A <select>'s automatic minimum size is its longest option. With the
      // default `min-inline-size: auto` one long header name holds the row
      // wider than the 264px pane — the row still wraps, but every wrap
      // leaves one control alone on its line, which is the layout the
      // wrapping decision exists to avoid. `flex: 1 1 auto` alone does not
      // fix it; the automatic minimum is what overrides the shrink.
      // The BOX rule, not merely a rule that names the field: the focus ring
      // below groups the same attributes, and an earlier draft of this guard
      // let the operator picker fall out of the box rule entirely while the
      // ring alone kept every assertion green.
      const boxRules = rulesSelecting(
        strippedCss(),
        (sel) =>
          sel.includes("data-pretable-filter-row-column") &&
          !sel.includes(":focus"),
      );
      expect(boxRules, "no leaf-row field box rule").toHaveLength(1);
      const [, selector, fields] = boxRules[0]!;
      // All three fields share it. A field dropped from the list keeps its
      // attribute (the ring still names it) and loses its border, height and
      // shrink — visibly a naked UA control in the pane.
      for (const attr of [
        "data-pretable-filter-row-operator",
        "data-pretable-filter-row-value",
      ]) {
        expect(
          selector,
          `[${attr}] is not in the leaf row's shared box rule`,
        ).toContain(attr);
      }
      // An EXPLICIT minimum is what overrides a <select>'s automatic
      // longest-option minimum, and any value does that — so this one is also
      // held to the section's 24px floor. `min-inline-size: 0` shrinks
      // identically while permitting a 4px-wide target, which would make the
      // 2.5.8 claim the block-size makes true on one axis and false on the
      // other.
      expect(
        fields,
        "the fields need an explicit min-inline-size of at least 24px: 0 shrinks the same way but gives back the WCAG 2.5.8 floor on the inline axis",
      ).toMatch(/min-inline-size:\s*(2[4-9]|[3-9]\d|\d{3,})px/);
      expect(fields).toMatch(/flex:\s*1 1 auto/);
      expect(fields).toMatch(/block-size:\s*24px/);
      expect(fields).toMatch(/box-sizing:\s*border-box/);
    });

    test("the set shape's checklist takes its own line, and rings by token", () => {
      // Two rules this section argues for in prose and nothing checked. The
      // checklist is a COLUMN of checkboxes in a wrapping row: without
      // `flex-basis: 100%` it sits beside the three 24px fields and sets the
      // row's height to the number of choices — an enum with twelve values
      // would draw a twelve-line row inside a 264px pane.
      const css = strippedCss();
      const list = css.match(
        /:where\(div\[data-pretable-filter-row-value\]\)\s*\{([\s\S]*?)\}/,
      )?.[1];
      expect(list, "no set-shape checklist rule").toBeDefined();
      expect(
        list,
        "the checklist must take its own line; beside the fields it sets the row's height to the number of choices",
      ).toMatch(/flex-basis:\s*100%/);

      // And its checkboxes ring in the section's token, not the UA's own: the
      // ring above deliberately does not reach inside the wrapper, so without
      // this rule the ring changes colour and shape halfway down the row.
      // A DESCENDANT of the wrapper — `…) input:focus-visible`, not
      // `input[…-value]:focus-visible`, which is the FIELDS' own ring and
      // contains every other substring this predicate could ask for. Written
      // loosely, this guard stayed green with the checkbox rule deleted.
      const ring = rulesSelecting(css, (sel) =>
        /\[data-pretable-filter-row-value\][^{]*\)\s+input[^{]*:focus-visible/.test(
          sel,
        ),
      );
      expect(
        ring.length,
        "no focus ring for the checklist's checkboxes; the fields' own ring does not reach inside the wrapper",
      ).toBe(1);
      expect(ring[0]![2]).toMatch(/outline:[^;]*var\(--pretable-focus-ring\)/);
    });

    test("the leaf row wraps", () => {
      // The section's most distinctive break from the columns section's
      // fixed-height row, argued at length in the CSS and — until this guard
      // — deletable with every other guard still green. Five controls do not
      // fit across a 264px pane minus the rails; a nowrap row pushes its
      // trailing control (the remove button) past the pane's edge, which
      // scrolls on the block axis only, so nothing can reach it again.
      const row = strippedCss().match(
        /:where\(\[data-pretable-filter-row\]\)\s*\{([\s\S]*?)\}/,
      )?.[1];
      expect(row, "no [data-pretable-filter-row] rule").toBeDefined();
      expect(
        row,
        "the leaf row must wrap; five controls do not fit across the pane and a nowrap row scrolls its remove button out of reach",
      ).toMatch(/flex-wrap:\s*wrap/);
    });
  });

  test("pseudo-element rules keep ::before outside the :where()", () => {
    // `:where([x]::before)` is INVALID: :where() takes a complex-selector-list
    // and a pseudo-element is not one, so a browser drops the entire rule and
    // the status dot silently never paints. Nothing else would catch it —
    // jsdom's parser is lenient, the token-resolution contract still passes
    // (the var is still textually referenced), and the :where()-wrapping test
    // above is satisfied either way. Write `:where([x])::before`.
    const css = fs
      .readFileSync(GRID_CSS, "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "");
    // Paren DEPTH, not a regex: `:where([x])::before` and `:where([x]::before)`
    // differ only in where the `::` falls relative to the closing paren, which
    // no flat pattern can tell apart once selectors nest (`:not()`, `:has()`).
    const offenders = [...css.matchAll(/([^{}]+)\{/g)]
      .map((m) => m[1].trim())
      .filter((sel) => sel && !sel.startsWith("@"))
      .filter((sel) => {
        let depth = 0;
        for (let i = 0; i < sel.length; i += 1) {
          if (sel[i] === "(") depth += 1;
          else if (sel[i] === ")") depth -= 1;
          else if (sel[i] === ":" && sel[i + 1] === ":" && depth > 0)
            return true;
        }
        return false;
      });
    expect(
      offenders,
      `pseudo-element inside :where() — a browser drops these rules entirely: ${offenders.join(", ")}`,
    ).toEqual([]);
  });

  describe("filter funnel touch target (WCAG 2.5.8)", () => {
    /**
     * The funnel used to be an 18x18 button and nothing else, which is the tap
     * target a phone got on every filterable column header. WCAG 2.5.8 (Target
     * Size, Minimum) asks for 24x24 CSS px.
     *
     * These are source assertions, not measurements, because jsdom refuses to
     * compute pseudo-element styles at all ("Not implemented: Window's
     * getComputedStyle() method: with pseudo-elements") and lays nothing out
     * regardless. The measurement that actually proved the fix was a hit-test
     * sweep — `document.elementFromPoint` over every pixel around the funnel —
     * run on an iPhone 13 profile in both Chromium and WebKit. What is pinned
     * here is the geometry that measurement depends on, so a later edit that
     * quietly breaks one of these invariants fails in CI rather than on a
     * phone.
     */
    const funnelRule = (css: string) =>
      css.match(
        /:where\(\[data-pretable-filter-funnel\]\)\s*\{([\s\S]*?)\}/,
      )?.[1];
    const afterRule = (css: string) =>
      css.match(
        /:where\(\[data-pretable-filter-funnel\]\)::after\s*\{([\s\S]*?)\}/,
      )?.[1];

    test("the hit area is a 24x24 pseudo-element, and the glyph stays 18x18", () => {
      const css = fs.readFileSync(GRID_CSS, "utf8");
      const base = funnelRule(css);
      expect(base, "no [data-pretable-filter-funnel] rule found").toBeDefined();
      // The drawn control must NOT grow: the header is dense by design, and the
      // hover chip and focus ring are painted on this box.
      expect(base).toMatch(/width:\s*18px/);
      expect(base).toMatch(/height:\s*18px/);

      const after = afterRule(css);
      expect(after, "no funnel ::after hit-area rule found").toBeDefined();
      expect(after).toMatch(/content:\s*""/);
      expect(after).toMatch(/width:\s*24px/);
      expect(after).toMatch(/height:\s*24px/);
    });

    test("the hit area is out of flow, so it cannot resize the header box", () => {
      // @pretable/ui's readDensity and @pretable/react's virtualisation both
      // measure header and row height in JS. Anything that grows the header's
      // painted box desynchronises painted layout from measured layout, so the
      // extra 6px has to come from an absolutely positioned box — not from
      // padding on the button, and not from a taller button.
      const css = fs.readFileSync(GRID_CSS, "utf8");
      expect(afterRule(css)).toMatch(/position:\s*absolute/);
      // ...which needs the button as its containing block.
      expect(funnelRule(css)).toMatch(/position:\s*relative/);
      // No padding on the button itself — that WOULD grow its border box.
      expect(funnelRule(css)).toMatch(/padding:\s*0/);
    });

    test("the hit area grows leftward only, clear of the 4px resize strip", () => {
      // @pretable/react parks the funnel slot at `left: -22` and the resize
      // strip at `left: -4` off the column's trailing edge, so the funnel's
      // right edge is flush against the strip.
      //
      // The strip itself is never at risk: it declares `z-index: 2` inside the
      // overlay anchor's stacking context, so it hit-tests above the funnel
      // whatever the funnel does. Measured on an iPhone 13, a centred hit area
      // takes exactly zero of the strip's pixels. What it takes is the
      // FUNNEL's: 3 of its 24px land under the strip, unreachable, and the
      // usable target comes back 21px wide — short of the 24 this rule exists
      // to reach. `right: 0` spends all 6 extra px on the header cell instead,
      // which is a sort target hundreds of px wide.
      const after = afterRule(fs.readFileSync(GRID_CSS, "utf8"));
      expect(after).toMatch(/right:\s*0/);
      // A `left` here would either re-centre the box or stretch it back over
      // the strip; `right: 0` plus a width has to be the whole horizontal
      // constraint.
      expect(after, "funnel hit area must not be left-anchored").not.toMatch(
        /(^|[;{\s])left:/,
      );
    });

    test("the hover-reveal rules still address the funnel, not the hit area", () => {
      // The funnel is invisible until the header row is hovered, the button
      // takes focus, or a filter is active. The hit area rides on the button's
      // own opacity, so those three rules must keep targeting the button.
      const css = fs.readFileSync(GRID_CSS, "utf8");
      expect(css).toMatch(
        /:where\(\[data-pretable-header-row\]:hover \[data-pretable-filter-funnel\]\)/,
      );
      expect(css).toMatch(
        /:where\(\[data-pretable-filter-funnel\]:focus-visible\)/,
      );
      expect(css).toMatch(
        /:where\(\[data-pretable-filter-funnel\]\[data-pretable-filter-active="true"\]\)/,
      );
      expect(funnelRule(css)).toMatch(/opacity:\s*0/);
    });
  });

  describe("header slot geometry (touch re-spacing)", () => {
    /**
     * The offsets that place the resize strip, the funnel and the column menu
     * off a column's trailing edge used to be INLINE STYLES in
     * `pretable-surface.tsx` (`left: -4`, `left: -22`, `left: -40`). Inline
     * style beats
     * every stylesheet rule — `!important` and `@layer` included — so no media
     * query could re-space them, and re-spacing them is the only way three
     * controls fit in a slot narrow enough to sit beside a 96px column.
     *
     * These are source assertions rather than measurements for the same reason
     * as the funnel target block above: jsdom lays nothing out. The measurement
     * that proves the geometry is the hit-test sweep in
     * `apps/website/e2e/grid-header-touch.spec.ts`. What is pinned here is the
     * mechanism that sweep depends on — a token the inline style can read, and
     * a coarse-pointer block that redefines it.
     */
    const overlayBlocks = (css: string) => [
      ...css.matchAll(
        /:where\(\[data-pretable-header-overlays\]\)\s*\{([\s\S]*?)\}/g,
      ),
    ];

    test("the slot offsets are tokens, not hardcoded positions", () => {
      const css = fs.readFileSync(GRID_CSS, "utf8");
      expect(css).toMatch(/--pretable-header-funnel-slot:/);
      expect(css).toMatch(/--pretable-header-menu-slot:/);
      // The strip's offset kept an inline `left: -4` through the touch pass,
      // because it is `display: none` on coarse pointers and nothing needed to
      // move it — which left it as the one piece of header geometry no theme
      // could reach.
      expect(css).toMatch(/--pretable-header-resize-slot:/);
    });

    test("the strip's width is derived from its slot, not declared twice", () => {
      // A themed offset with a literal width would detach the strip from the
      // trailing edge it exists to hug. One number, one place: `left` comes
      // from the token and the width is that token negated.
      const css = fs
        .readFileSync(GRID_CSS, "utf8")
        .replace(/\/\*[\s\S]*?\*\//g, "");
      const rule = css.match(
        /:where\(\[data-pretable-resize-handle\]\)\s*\{([^}]*)\}/,
      )?.[1];
      expect(rule, "no resize handle rule").toBeDefined();
      expect(rule).toMatch(
        /width:\s*calc\(-1 \* var\(--pretable-header-resize-slot\)\)/,
      );
      expect(rule, "a literal width would out-declare the token").not.toMatch(
        /width:\s*\d/,
      );
    });

    test("a coarse-pointer block re-spaces them", () => {
      // The whole point of moving them: a media query must be able to move the
      // slots. Assert the tokens are redefined INSIDE the coarse block, not
      // merely that such a block exists somewhere in the file.
      const css = fs
        .readFileSync(GRID_CSS, "utf8")
        .replace(/\/\*[\s\S]*?\*\//g, "");
      const coarse = css.match(
        /@media \(pointer: coarse\)\s*\{([\s\S]*?)\n {2}\}/,
      )?.[1];
      expect(coarse, "no @media (pointer: coarse) block").toBeDefined();
      expect(coarse).toMatch(/--pretable-header-funnel-slot:\s*-24px/);
      expect(coarse).toMatch(/--pretable-header-menu-slot:\s*-48px/);
    });

    test("the fine-pointer defaults leave room for the funnel's tap target", () => {
      // The strip 4px back from the trailing edge, the funnel 22px back
      // (immediately left of the strip), and the menu 46px back — 24 behind the
      // funnel's slot, not 18, because the funnel's 18px glyph carries a 24px
      // `::after` that reaches to -28.
      //
      // -40 is the value this must never drift back to: there the menu button
      // painted over the last six pixels of the funnel's tap target and the
      // funnel measured 17px reachable, narrower than its own glyph. The
      // measurement lives in `apps/website/e2e/grid-header-touch.spec.ts`;
      // jsdom lays nothing out, so what is pinned here is the number.
      const css = fs
        .readFileSync(GRID_CSS, "utf8")
        .replace(/\/\*[\s\S]*?\*\//g, "");
      const base = overlayBlocks(css)[0]?.[1];
      expect(base, "no [data-pretable-header-overlays] rule").toBeDefined();
      expect(base).toMatch(/--pretable-header-resize-slot:\s*-4px/);
      expect(base).toMatch(/--pretable-header-funnel-slot:\s*-22px/);
      expect(base).toMatch(/--pretable-header-menu-slot:\s*-46px/);
    });

    test("the coarse block comes after the defaults it overrides", () => {
      // Every selector in this file is :where()-flattened to (0,0,0), so source
      // order is the only cascade lever there is. Declared first, the media
      // query loses and a phone silently keeps the desktop spacing.
      const css = fs.readFileSync(GRID_CSS, "utf8");
      const base = css.indexOf("--pretable-header-funnel-slot: -22px");
      const coarse = css.indexOf("@media (pointer: coarse)");
      expect(base, "no fine-pointer default").toBeGreaterThan(-1);
      expect(coarse, "no coarse block").toBeGreaterThan(-1);
      expect(
        coarse,
        "the coarse block must follow the defaults",
      ).toBeGreaterThan(base);
    });

    test("the resize strip is dropped on coarse pointers, in CSS", () => {
      // `display: none` rather than a `matchMedia` guard in React: the element
      // then generates no boxes at all — not painted, not hit-testable — and
      // there is no client/server disagreement to hydrate through. A 4px strip
      // is unusable with a finger at any size, so this removes a WCAG 2.5.8
      // failure by removing the control.
      const css = fs
        .readFileSync(GRID_CSS, "utf8")
        .replace(/\/\*[\s\S]*?\*\//g, "");
      const coarse = css.match(
        /@media \(pointer: coarse\)\s*\{([\s\S]*?)\n {2}\}/,
      )?.[1];
      expect(coarse, "no @media (pointer: coarse) block").toBeDefined();
      expect(coarse).toMatch(
        /:where\(\[data-pretable-resize-handle\]\)\s*\{[^}]*display:\s*none/,
      );
    });

    test("the funnel stops being hover-revealed on coarse pointers", () => {
      // There is no hover on a phone, so a hover-revealed control is simply
      // invisible: the funnel computes `opacity: 0` on every phone today, which
      // makes the 24px target it already has a target nobody can see.
      const css = fs
        .readFileSync(GRID_CSS, "utf8")
        .replace(/\/\*[\s\S]*?\*\//g, "");
      const coarse = css.match(
        /@media \(pointer: coarse\)\s*\{([\s\S]*?)\n {2}\}/,
      )?.[1];
      expect(coarse).toMatch(
        /:where\(\[data-pretable-filter-funnel\]\)\s*\{[^}]*opacity:\s*1/,
      );
    });

    test("the column menu buys its 24px the same way the funnel did", () => {
      // A transparent, out-of-flow ::after — NOT padding and not a bigger
      // button. The glyph stays 18px because the button is the box the hover
      // chip and the focus ring paint on, and out-of-flow is what guarantees
      // the header's own box cannot change size: @pretable/ui's `readDensity`
      // and @pretable/react's virtualisation both measure header and row height
      // in JS, and a taller header would desynchronise painted from measured.
      const css = fs.readFileSync(GRID_CSS, "utf8");
      const button = css.match(
        /:where\(\[data-pretable-column-menu-button\]\)\s*\{([\s\S]*?)\}/,
      )?.[1];
      expect(button, "no column-menu button rule").toBeDefined();
      expect(button).toMatch(/width:\s*18px/);
      expect(button).toMatch(/height:\s*18px/);
      expect(button).toMatch(/padding:\s*0/);
      // The ::after needs the button as its containing block.
      expect(button).toMatch(/position:\s*relative/);

      // Inside the coarse block, unlike the funnel's. Unconditional, it would
      // silently widen the menu's DESKTOP hit target from 18px to 24px and take
      // 6px off the header cell's sort area — a fine-pointer geometry change
      // this project is not entitled to make. Matched against the coarse block
      // rather than the whole file, so hoisting it out fails here.
      const coarseOnly = fs
        .readFileSync(GRID_CSS, "utf8")
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .match(/@media \(pointer: coarse\)\s*\{([\s\S]*?)\n {2}\}/)?.[1];
      const after = coarseOnly?.match(
        /:where\(\[data-pretable-column-menu-button\]\)::after\s*\{([\s\S]*?)\}/,
      )?.[1];
      expect(
        after,
        "no column-menu ::after hit-area rule inside @media (pointer: coarse)",
      ).toBeDefined();
      expect(after).toMatch(/content:\s*""/);
      expect(after).toMatch(/position:\s*absolute/);
      expect(after).toMatch(/width:\s*24px/);
      expect(after).toMatch(/height:\s*24px/);
      // Anchored to the trailing edge like the funnel's, so the two 24px boxes
      // abut instead of overlapping: the menu slot ends exactly where the
      // funnel's hit area begins.
      expect(after).toMatch(/right:\s*0/);
      expect(after, "menu hit area must not be left-anchored").not.toMatch(
        /(^|[;{\s])left:/,
      );
    });
  });

  test("every grid.css rule selector is wrapped in :where()", () => {
    const css = fs.readFileSync(GRID_CSS, "utf8");
    const noComments = css.replace(/\/\*[\s\S]*?\*\//g, "");
    const selectors = [...noComments.matchAll(/([^{}]+)\{/g)]
      .map((m) => m[1].trim())
      .filter(Boolean);
    expect(selectors.length).toBeGreaterThan(5);
    for (const sel of selectors) {
      if (/^@/.test(sel)) continue; // layer/media/supports/etc. block openers — not selectors
      expect(sel, `selector not wrapped in :where(): "${sel}"`).toMatch(
        /^:where\(/,
      );
    }
  });
});
