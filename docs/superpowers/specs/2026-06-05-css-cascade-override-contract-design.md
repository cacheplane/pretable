# CSS Cascade & Override Contract — Design

**Date:** 2026-06-05
**Status:** Approved (pending spec review)
**Scope:** Make `@pretable/ui`'s shipped CSS overridable by external consumers via a deliberate cascade-layer + low-specificity contract. One-time, behavior-preserving migration.

## Problem

`@pretable/ui` ships the grid's visual styling (`grid.css`) plus two themes and a token set. Today the override story works for **tokens** (consumers set `--pretable-*` custom properties and the cascade picks them up), but **deep CSS overrides are brittle**:

- `grid.css` selectors are plain attribute selectors with real specificity: `[data-pretable-cell]` is (0,1,0), state selectors like `[data-pretable-cell][data-selected="true"]` are (0,2,0), and `[data-pretable-row]:hover [data-pretable-cell]` is (0,3,0). A consumer must match or exceed those to win — a specificity war.
- Nothing is in a cascade layer (`@layer`: 0 uses) and nothing uses `:where()` (0 uses). There is no boundary protecting the grid from a consumer's reset/utility CSS, and no mechanism that lets consumer CSS win predictably.
- All real-world consumers (and all three apps) use Tailwind v4, whose Preflight reset is low-specificity **element** selectors (e.g. `td {}`, (0,0,1)). Any naive "just lower our specificity" approach lets Preflight clobber the grid.

pretable is pre-1.0 with no external consumers (see `feedback_no_backcompat`), so the CSS contract can change freely — but it should be **locked deliberately** now, because once consumers depend on cascade behavior, changing it is a breaking change.

## Goal

A documented, robust override contract supporting **both** workflows as first-class:

1. **Token overrides** (recolor/resize) — unchanged, still the blessed path.
2. **Deep per-part CSS overrides** — a consumer's selector targeting any grid part (cell, header, selected state, resize handle, …) wins **without** `!important` or specificity tricks, even a bare class.

Success criterion: a consumer's `.my-grid [data-pretable-cell] { color: … }` — or a single class, or a Tailwind utility — overrides the grid default, and a `normalize`/Preflight reset does **not** clobber the grid.

## Approach (chosen: `@layer` + `:where()` together)

The two mechanisms solve different problems and are shipped together (the modern best practice — Radix Themes, Ark UI, etc.):

- **`@layer`** controls _which stylesheet wins_ across the cascade. Unlayered CSS and later-declared layers always beat an earlier layer regardless of specificity.
- **`:where()`** controls _specificity within_ a layer — wrapping a selector in `:where()` makes it specificity (0,0,0) while preserving what it matches.

Rejected alternatives:

- **`:where()` only** — Preflight's element selectors (0,0,1) beat the grid's (0,0,0) and silently clobber it. Fatal for Tailwind/reset users.
- **`@layer` only** — keeps the brittle internal specificity; same-layer overrides still hit (0,2,0)/(0,3,0) walls, and an _unlayered_ consumer reset would beat the layered grid.

## Design

### 1. Single `pretable` cascade layer — applied to `grid.css` only

`grid.css` wraps its contents in `@layer pretable { … }`. This is where the override robustness is needed: the grid's **selector rules** are what consumers fight with and what Preflight can clobber.

- **Token files (`tokens.css`, `themes/*.css`) stay UNLAYERED.** Two reasons: (a) **jsdom constraint** — jsdom's `getComputedStyle` returns `""` for a custom property declared inside `@layer` (verified 2026-06-05), so layering the token files would break the existing jsdom token-resolution tests (`contract.test.ts`, `density.test.ts`); (b) **marginal benefit** — token overrides already win by source order, and the docs already instruct consumers to override _after_ importing the theme. `var()` lookups ignore layers, so layered grid rules resolve unlayered tokens fine.
- **No sublayers.** A single layer satisfies the entire contract; sublayers add nuance for no benefit (YAGNI).
- **`tailwind.css` is NOT layered.** It is the `@theme inline` bridge that exposes `--pretable-*` to Tailwind's utility namespace. `var()` lookups ignore layers, so leaving it unlayered is correct and safe; the implementation confirms the bridge still resolves token values.

### 2. `:where()`-flatten every default selector

Mechanical rewrite of every rule in `grid.css`:

```css
[data-pretable-cell] { … }                          →  :where([data-pretable-cell]) { … }
[data-pretable-cell][data-selected="true"] { … }    →  :where([data-pretable-cell][data-selected="true"]) { … }
[data-pretable-row]:hover [data-pretable-cell] { … } →  :where([data-pretable-row]:hover [data-pretable-cell]) { … }
```

Every default rule becomes specificity (0,0,0). Token declarations (`:root`, `[data-theme="dark"]`, `[data-density="…"]`) live in the unlayered token files (§1) and are unchanged; consumer token overrides win by source order as today (override after importing the theme).

### 3. State precedence becomes source-order (the one non-mechanical risk)

Today `[data-selected]` (0,2,0) beats base `[data-pretable-cell]` (0,1,0) by specificity. After flattening, all rules are (0,0,0), so precedence is **pure source order**. The migration must keep state/structural rules ordered least-intent → most-intent: base → zebra (`:nth-child(even)`) → hover → pinned → selected → focused → role-based selected/focused.

**Audit result (done during planning):** the current source order is already `base → zebra → hover → pinned → selected → focused`, so `:where()`-flattening reproduces the intuitive precedence **with no rule reordering**. There is exactly **one behavior delta**: today zebra/hover are (0,3,0) and beat selected/focused (0,2,0) by specificity (a latent artifact — a selected cell in an even row, or while hovered, shows the zebra/hover background instead of the selection background). After flattening, source order makes **selected/focused win** over zebra/hover, which is the correct/intended behavior. This delta is deliberate and locked by the Playwright cascade test. Everything else is mechanical and behavior-preserving (pinned-vs-selected and the `[role="gridcell"]` rules keep their current source-order outcome).

### 4. The documented override contract

Consumers override via, in increasing power:

1. **Tokens** — set any `--pretable-*` at `:root` or scoped. Unchanged blessed path.
2. **Deep CSS** — any selector targeting a grid part wins automatically (defaults are (0,0,0) and layered). No `!important`, no specificity tricks.
3. **Predictable ordering** — because all Pretable CSS is in `@layer pretable`, anything unlayered or in a later layer wins.

Recommended layer order, declared once by the consumer (and by our apps as the reference example):

```css
@layer theme, base, pretable, components, utilities;
```

- `pretable` **after `base`** → Preflight / `normalize` resets (low-specificity element selectors) cannot clobber grid borders/padding.
- `pretable` **before `utilities`** → a consumer's `class="bg-red-500"` on a cell still wins.
- A consumer writing plain unlayered CSS needs no configuration — unlayered beats all layers.

Edge cases:

- **No layers at all** → consumer CSS is unlayered → always wins. Zero config.
- **Unlayered `normalize.css`** → ⚠️ unlayered beats layered, so a bare unlayered reset would beat the grid. Documented mitigation: put resets in `@layer base`. In practice Preflight is the real concern and the layer order solves it; a generic reset rarely targets `[data-pretable-*]` attributes anyway.

### 5. App-side change (reference example)

`apps/website` and `apps/bench` global CSS gain the explicit `@layer theme, base, pretable, components, utilities;` order line so their Tailwind + grid compose predictably. This doubles as the copy-paste reference for an external Tailwind consumer.

## Files changed

**`packages/ui`:**

- `src/grid.css` — wrap in `@layer pretable`; `:where()`-flatten all selectors (incl. `.pt-sr-only`, `button[...]`, `[role="gridcell"]...`); source order already yields correct state precedence (no reordering).
- `src/tokens.css`, `src/themes/material.css`, `src/themes/excel.css` — **unchanged** (stay unlayered; see §1).
- `src/tailwind.css` — unchanged; verify the bridge still resolves tokens.
- `README.md` — update the CSS-contract section.

**Apps:**

- `apps/website` + `apps/bench` global CSS — add the `@layer …` order line.

**Docs (consumer-facing deliverable):**

- **New** `apps/website/content/docs/theming/cascade-and-overrides.mdx` — the contract, the layer-order line + explanation, Tailwind/reset guidance, and 2–3 deep-override worked examples (recolor selected cell, restyle header, custom resize handle).
- **Update** `theming/index.mdx` (mention the cascade layer in the architecture overview), `tailwind-css-in-js.mdx` (the ordering line), and a light note in `override-tokens.mdx` (overrides now win regardless of specificity).

## Testing

1. **Structural lint test (CI-cheap, no browser) — primary regression guard.** A unit test over `grid.css` asserting: (a) the file content is wrapped in `@layer pretable`, and (b) every style rule's selector is inside `:where(…)`. A future edit that adds a raw `[data-pretable-cell] {…}` selector fails CI, locking the contract.
2. **One Playwright spec (real browser cascade).** Render the grid with an injected consumer stylesheet and assert `getComputedStyle` reflects the override: one token override and one deep-CSS override (e.g. `.consumer [data-pretable-cell] { color: rgb(1, 2, 3) }` wins over the default). Proves the end-to-end "consumer always wins" promise that jsdom cannot validate.

## Out of scope (tracked separately)

- Semantic targeting attributes (`data-column-id`, `data-cell-type`) — enables CSS targeting of specific columns / cell kinds.
- Brand/semantic token layer — consumer maps their design system once instead of hand-mapping the raw token slots.
- Dark-mode for Excel / general dark-theme authoring guide.
- Unstyled/headless variant — overlaps the separate `@pretable/core` headless-engine project.

## Risks

- **State-ordering regression** (§3) — mitigated by the rule-pair audit and the Playwright cascade test.
- **Tailwind bridge** — `tailwind.css` resolving layered tokens; mitigated by an explicit verification step (`var()` ignores layers, so expected safe).
- **Layer-order education** — consumers must declare the order line for Tailwind/reset coexistence; mitigated by docs + the apps serving as a working reference.
