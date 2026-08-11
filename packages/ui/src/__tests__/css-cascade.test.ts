import { describe, expect, test } from "vitest";
import fs from "node:fs";
import path from "node:path";

const GRID_CSS = path.resolve(__dirname, "../grid.css");
const THEMES_DIR = path.resolve(__dirname, "../themes");

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
    // Both state fills are translucent in both shipped themes — Excel sets
    // --pretable-bg-hover to `transparent` outright, and --pretable-selection-bg
    // is a color-mix at 8% in both. Declared as the `background` SHORTHAND these
    // rules replace the surface fill the earlier rules painted. On a pinned cell
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
