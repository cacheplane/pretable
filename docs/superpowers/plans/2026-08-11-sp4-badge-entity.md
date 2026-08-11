# SP4 (slice 2): Badge and Entity

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the badge and entity presentations, and have the hero adopt them — replacing two hand-rolled copies that both fail contrast.

**Architecture:** Two rules in `grid.css` and two thin components in `@pretable/react`, mirroring the delta and status shipped in slice 1. No new tokens: both reuse the semantic ramp and `--pretable-text-dim`.

**Tech Stack:** vanilla CSS in `@pretable/ui`, React 19 + TypeScript in `@pretable/react`, vitest + jsdom, API Extractor.

---

## Why these two, and not the meter

Badge and entity each have a real consumer in the hero today. The segmented meter does not, and this project has repeatedly been burned by shipping things nothing reads — so it waits until something needs it.

## Two contrast findings that shape the design

**1. A tinted badge cannot pass AA.** Tinting a chip's background with the text's own hue eats the contrast. Computed against the ramp shipped in slice 1:

| tint over white | positive | negative | warning | info |
|---|---|---|---|---|
| 10% | 4.38 | 4.13 | 4.32 | 4.49 |
| 12% | 4.27 | 4.01 | 4.20 | 4.37 |
| 14% | 4.14 | 3.89 | 4.09 | 4.24 |

Every cell is under 4.5. **The hero's current pills use 14%**, so they are shipping at 3.89–4.24 today.

The fix is to follow the reference designs *more* closely, not less. Their badge is explicitly a white chip with a hairline border and small restrained text — not a tinted one. So: **the badge never tints its fill.** Tone is carried by the text colour on the grid surface, where it measures 4.83–5.17, plus an optional leading dot. The border uses `--pretable-rule-strong`, which is 4.00:1 and only owes 3:1 as a UI boundary.

**2. Secondary lines must not use opacity.** Both hand-rolled two-line stacks in the hero reach for it and both fail: the Day P&L percentage rendered 2.27:1 (fixed in slice 1) and `.symbolSub` renders ~`#818184` = **3.88:1** today, on every company name in the pinned column. The entity's secondary line therefore uses `--pretable-text-dim` (7.72:1 on white), never opacity. Preventing that repeat is most of the justification for the library owning this pattern at all.

---

### Task 1: The two presentation rules

- [ ] **Step 1: Add failing guards** in `packages/ui/src/__tests__/css-cascade.test.ts` asserting that a badge rule exists and does **not** set a tinted background from the ramp, and that the entity's secondary line reads `--pretable-text-dim` and does **not** use `opacity`.

- [ ] **Step 2: Run and confirm they fail.**

- [ ] **Step 3: Add to `grid.css`**, with the other cell presentations, every selector `:where()`-wrapped:

```css
  /* Badge: a hairline chip, never a tinted one. Tinting the fill with the
     text's own hue costs ~0.6 of contrast and drops every tone below AA — 4.14
     at a 10% tint, worse deeper. The reference designs got this right: a white
     chip with a hairline and restrained text. Tone rides on the TEXT, which
     measures 4.83–5.17 on the grid surface. */
  :where([data-pretable-badge]) {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    padding: 1px 8px;
    border: 1px solid var(--pretable-rule-strong);
    border-radius: 999px;
    background: var(--pretable-bg-grid);
    color: var(--pretable-text-cell);
    font-size: 0.85em;
    white-space: nowrap;
  }
  :where([data-pretable-badge][data-pretable-tone="positive"]) {
    color: var(--pretable-positive);
  }
  :where([data-pretable-badge][data-pretable-tone="negative"]) {
    color: var(--pretable-negative);
  }
  :where([data-pretable-badge][data-pretable-tone="warning"]) {
    color: var(--pretable-warning);
  }
  :where([data-pretable-badge][data-pretable-tone="info"]) {
    color: var(--pretable-info);
  }

  /* Entity: a primary line with a quieter secondary beneath it — the identity
     column pattern. The secondary takes --pretable-text-dim rather than an
     opacity, because every hand-rolled version of this reached for opacity and
     every one of them failed AA. */
  :where([data-pretable-entity]) {
    display: flex;
    flex-direction: column;
    justify-content: center;
    min-width: 0;
    line-height: 1.3;
  }
  :where([data-pretable-entity-primary]) {
    font-weight: 600;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  :where([data-pretable-entity-secondary]) {
    color: var(--pretable-text-dim);
    font-size: 0.85em;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
```

**Pseudo-element warning:** slice 1 established that `:where(x::before)` is invalid — the engine keeps it as an empty `:where()` that matches nothing while the rule still appears in `cssRules`. If you add any pseudo-element rule here, write `:where(x)::before`. There is already a paren-depth guard; keep it passing.

- [ ] **Step 4: Verify and commit** — `pnpm --filter @pretable/ui test`, then `feat(ui): add the badge and entity presentations`.

---

### Task 2: The components

- [ ] **Step 1: Failing tests** in `packages/react/src/__tests__/cells.test.tsx` (extend the existing file): a badge renders its label and, with a tone, the matching `data-pretable-tone`; an untoned badge sets no tone attribute; an entity renders both lines, and renders only the primary when no secondary is given.

- [ ] **Step 2: Extend `packages/react/src/cells.tsx`** with `PretableBadge` (`tone?`, `children`) and `PretableEntity` (`primary`, `secondary?`). Keep both presentational — no state, no effects, no measurement. Match the prop-typing style `PretableDelta` and `PretableStatus` already use, and carry the same explicit `@public` tags so the API report stays warning-free.

- [ ] **Step 3: Export** both plus their prop types from `packages/react/src/public_api.ts`.

- [ ] **Step 4:** `pnpm build && pnpm api`, then `pnpm api:check`. Build first — a stale `dist/` silently strips exports.

- [ ] **Step 5: Commit** as `feat(react): add the badge and entity cell presentations`.

---

### Task 3: The hero adopts both

- [ ] **Step 1: Symbol column → entity.** In `positionColumns.tsx`, replace the hand-rolled `<span className={styles.symbol}>` stack with `PretableEntity`. Delete `.symbol` and `.symbolSub` from `cells.module.css`. This is the fix for the 3.88:1 company name.

- [ ] **Step 2: Analyst pills → badge.** Replace the `.pill`/`.pillTrim`/`.pillWatch`/`.pillRisk`/`.pillHold` spans with `PretableBadge` carrying the matching tone. Delete all five rules. This is the fix for the 3.89–4.24 tinted chips.

- [ ] **Step 3:** Confirm nothing else references the deleted classes.

- [ ] **Step 4: Look at it.** The pills change from tinted fills to hairline chips — a visible change to the hero. Report whether the badges still read as status at a glance, and whether the Symbol column's secondary line is now legible rather than washed out. If the hairline chips read as too quiet next to the analyst prose, say so plainly rather than accepting it.

- [ ] **Step 5: Commit** as `feat(website): use the library's badge and entity presentations`.

---

### Task 4: Verification

- [ ] `pnpm --filter @pretable/ui test`, `pnpm --filter @pretable/react test`, `pnpm --filter @pretable/app-website test`, `pnpm typecheck`, `pnpm lint`, `pnpm format`, `pnpm api:check`.
- [ ] The Playwright cascade gate.
- [ ] Website e2e. **Use the ROOT playwright binary** — the one in `apps/website/node_modules/.bin` is a stale 1.60 shim that shadows the 1.62 the specs need and fails with a misleading "No tests found". Serve a production build and pass `BASE_URL`.
- [ ] Recompute the contrast of the badge text and the entity secondary as actually rendered, and report the numbers.

## Self-review

**Brief coverage.** Four of the five reference patterns now ship. The segmented meter is deliberately held back until something consumes it.

**Both fixes are accessibility fixes disguised as refactors** — the hero's pills and its company names are both below AA today, and adopting the library primitives is what corrects them. That is the strongest possible argument for these primitives existing.

**No new tokens.** Badge and entity reuse the ramp and `--pretable-text-dim`, so nothing new can go dead.
