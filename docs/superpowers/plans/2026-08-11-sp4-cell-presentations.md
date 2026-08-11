# SP4 (slice 1): Semantic Ramp + Delta and Status Cells

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the first two cell presentations from the reference designs — a signed numeric delta and a status dot — together with the semantic colour ramp they need, so the ramp never exists without a consumer.

**Architecture:** Four semantic tokens land in all three themes. `grid.css` consumes them immediately via two new presentation rules; soft tints are derived with `color-mix` rather than becoming four more tokens. Two thin React components in `@pretable/react` emit the markup. This is the first *public* component surface in that package, so the API report moves.

**Tech Stack:** vanilla CSS in `@pretable/ui`, React 19 + TypeScript in `@pretable/react`, vitest + jsdom, API Extractor.

---

## Why these two first

Of the five patterns extracted from the reference screenshots, the delta and the status dot are the two the hero already hand-rolls, so adopting them proves the whole idea end to end. Badge, meter and entity follow in slice 2.

## The one rule that governs this plan

**No token ships without a consumer.** Four separate times this project has found a token declared by every theme and read by nothing — `data-pretable-numeric`, the toolbar rules, the seam, the card shadow — and two of them shipped *documented as working*. The semantic tokens are therefore introduced in the same commit as the `grid.css` rules that read them, never before.

## Contrast, computed

The reference's own semantic hues **fail** at text sizes and cannot be copied: its green `#16a34a` is 3.30:1 against every theme's grid surface and its amber `#d97706` is 3.19:1, both well under the 4.5 AA floor. They work in the screenshots because they sit inside chips and bold glyphs, not as 14px text.

Re-derived at similar saturation but darker, verified against all three light grounds (`#ffffff`, `#fcfcfc`, `#ffffff`):

| token | light | ratio | dark | ratio |
|---|---|---|---|---|
| `--pretable-positive` | `#15803d` | 5.02 | `#4ade80` | 9.78 |
| `--pretable-negative` | `#dc2626` | 4.83 | `#fca5a5` | 8.98 |
| `--pretable-warning` | `#a16207` | 4.92 | `#fbbf24` | 10.21 |
| `--pretable-info` | `#2563eb` | 5.17 | `#93b4ff` | 8.29 |

The light set is deliberately tight (4.83–5.17) so no one colour reads heavier than its neighbours. Excel is light-only and takes the light set.

---

### Task 1: Fix the row-height measurement bug (prerequisite)

`packages/react/src/row-height.ts` measures **only** `[data-pretable-wrap="true"]` cells when any exist, falling back to all cells only when none do. So a two-line presentation in a normal column, in a row that also has a wrap column, is measured at single-line height and clipped — in browsers only, invisible to jsdom. Every multi-line primitive in this plan trips it.

- [ ] **Step 1: Write the failing test**

In `packages/react/src/__tests__/`, add a test that builds a row containing one `[data-pretable-wrap="true"]` cell with a short single-line content height and one non-wrap cell with a taller content height, then asserts `measureRenderedRowHeight` returns the height driven by the **taller** cell. Stub `getComputedStyle` and the cell measurement the way the existing `row-height` tests do — copy their harness rather than inventing one.

- [ ] **Step 2: Run it and confirm it fails** — the returned height will reflect the short wrap cell.

- [ ] **Step 3: Measure every cell**

Replace the conditional with an unconditional query of all `[data-pretable-cell]` in the row. The wrap-preference was an optimisation, and it is wrong: `Math.max` over every cell is the correct definition of a row's content height, and the cells are already being walked.

Leave a comment recording that preferring wrap cells silently clipped any taller non-wrap cell.

- [ ] **Step 4: Verify and commit**

`pnpm --filter @pretable/react test`. Commit as `fix(react): measure every cell when sizing a row, not only wrapped ones`.

---

### Task 2: The semantic ramp, with its consumers

- [ ] **Step 1: Add the four tokens to the contract (failing test)**

In `packages/ui/src/__tests__/contract.test.ts`, add to `TOKENS`:

```ts
  "pretable-positive",
  "pretable-negative",
  "pretable-warning",
  "pretable-info",
```

Count goes 45 → 49. Run `pnpm --filter @pretable/ui test -- contract` and confirm it fails for all three themes.

- [ ] **Step 2: Define them**

Add to the `:root` of `excel.css`, `material.css` and `pretable.css` using the light values from the table above, and to the `[data-theme="dark"]` blocks of `material.css` and `pretable.css` using the dark values. Comment the block with the fact that the reference's own hues fail AA at text sizes and these are re-derived — that reasoning is the whole justification for the values and will otherwise be lost.

- [ ] **Step 3: Add the two presentation rules to `grid.css`**

Placed with the other cell rules, `:where()`-wrapped like everything else:

```css
  /* Signed numeric change. The direction is carried by a glyph as well as by
     colour, so it survives greyscale and colour-blindness — colour alone is not
     an accessible signal. The glyph is a ::before so a cell costs no extra DOM
     node per row in a virtualized grid. */
  :where([data-pretable-delta]) {
    display: inline-flex;
    align-items: baseline;
    gap: 4px;
    font-variant-numeric: tabular-nums lining-nums;
  }
  :where([data-pretable-delta="up"]) {
    color: var(--pretable-positive);
  }
  :where([data-pretable-delta="down"]) {
    color: var(--pretable-negative);
  }
  :where([data-pretable-delta="flat"]) {
    color: var(--pretable-text-dim);
  }
  :where([data-pretable-delta]::before) {
    font-size: 0.85em;
    line-height: 1;
  }
  :where([data-pretable-delta="up"]::before) {
    content: "▲";
  }
  :where([data-pretable-delta="down"]::before) {
    content: "▼";
  }
  :where([data-pretable-delta="flat"]::before) {
    content: "–";
  }

  /* Status: a dot plus a label. Both colour AND the label carry the state, for
     the same reason. */
  :where([data-pretable-status]) {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    color: var(--pretable-text-cell);
  }
  :where([data-pretable-status]::before) {
    content: "";
    flex: none;
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background: var(--pretable-text-dim);
  }
  :where([data-pretable-status="positive"]::before) {
    background: var(--pretable-positive);
  }
  :where([data-pretable-status="negative"]::before) {
    background: var(--pretable-negative);
  }
  :where([data-pretable-status="warning"]::before) {
    background: var(--pretable-warning);
  }
  :where([data-pretable-status="info"]::before) {
    background: var(--pretable-info);
  }
```

**Note on the glyphs:** these are Unicode characters, which SP2b deliberately removed elsewhere. That is a real tension. Resolve it by using the icon set instead if the components can supply it — the components render the markup, so they can emit `<SortAscIcon>`-style glyphs rather than relying on `::before`. **Decide and report which you did and why**; do not silently ship Unicode after a whole sub-project removed it.

- [ ] **Step 4: Guard**

Add a `css-cascade.test.ts` test asserting both rules exist, that they read the semantic tokens, and that direction is conveyed by something other than colour alone. Add a `contract.test.ts` assertion that all four tokens are actually referenced by `grid.css` — the reverse check this project keeps needing.

- [ ] **Step 5: Verify and commit**

`pnpm --filter @pretable/ui test`. Commit as `feat(ui): add the semantic ramp and the delta and status presentations`.

---

### Task 3: The React components

- [ ] **Step 1: Write failing tests** in `packages/react/src/__tests__/cells.test.tsx` covering: a positive value renders `data-pretable-delta="up"`, a negative one `"down"`, zero `"flat"`; the formatted text is the caller's, not invented; a status renders its tone and its label text.

- [ ] **Step 2: Create `packages/react/src/cells.tsx`**

Two components. `PretableDelta` takes a `value: number` and a `children` (the already-formatted string) and picks the direction from the sign — it must **not** format the number itself, because formatting is the consumer's concern and locale-dependent. `PretableStatus` takes `tone: "positive" | "negative" | "warning" | "info" | "neutral"` and children.

Keep them presentational: no state, no effects, no measurement.

- [ ] **Step 3: Export publicly**

Add both, and their prop types, to `packages/react/src/public_api.ts`. Unlike the icon set, these ARE for consumers.

- [ ] **Step 4: Regenerate the API report** — `pnpm build && pnpm api`, then `pnpm api:check`. Building first is mandatory. Expect a real diff this time.

- [ ] **Step 5: Commit** as `feat(react): add the delta and status cell presentations`.

---

### Task 4: Adopt them in the hero

- [ ] **Step 1:** In `apps/website/app/components/heroGrid/positionColumns.tsx`, replace the hand-rolled Day P&L `.up`/`.down` spans with `PretableDelta`. The two-line stack keeps its sub-line.
- [ ] **Step 2:** Delete the now-unused `.up`/`.down` rules from `cells.module.css` and confirm nothing else references them.
- [ ] **Step 3:** Confirm in a browser that the P&L column still reads correctly, now follows the theme, and that the delta direction is legible.
- [ ] **Step 4:** Commit as `feat(website): use the library's delta presentation for Day P&L`.

---

### Task 5: Verification

- [ ] `pnpm --filter @pretable/ui test`, `pnpm --filter @pretable/react test`, `pnpm --filter @pretable/app-website test`, `pnpm typecheck`, `pnpm lint`, `pnpm format`, `pnpm api:check`.
- [ ] The Playwright cascade gate.
- [ ] Website e2e. **Use the ROOT playwright binary** — `apps/website/node_modules/.bin/playwright` is a stale 1.60 shim that shadows the 1.62 the specs need and fails with a misleading "No tests found". Serve a production build and pass `BASE_URL`.
- [ ] Look at the hero and report what the delta actually looks like.

## Self-review

**Brief coverage.** Two of the five reference patterns ship here; badge, meter and entity are slice 2. The semantic ramp lands with consumers, satisfying the no-dead-token rule.

**The Unicode tension is real and flagged rather than hidden** — SP2b removed exactly these characters from the grid, so re-introducing them in a `::before` needs a deliberate answer, which Task 2 Step 3 demands.

**Accessibility is a design constraint here, not a checkbox:** direction is carried by glyph *and* colour, status by dot *and* label, so neither depends on colour perception. The values were computed rather than taken from the reference, because the reference's fail.
