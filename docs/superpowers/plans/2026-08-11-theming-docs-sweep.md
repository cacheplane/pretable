# Theming Docs Sweep

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the theming docs describe what actually ships, and add the guard that stops them drifting again.

**Architecture:** Extend the existing docs-vs-API guard to cover the token reference — it currently cannot see it — then fix the content it starts failing on, then reposition `pretable.css` as the documented default.

**Tech Stack:** MDX under `apps/website/content/docs/theming/`, vitest for the guard.

---

## What is actually wrong

**The token reference is unguarded and has drifted.** `apps/website/lib/docs/__tests__/docs-api-surface.test.ts` only treats a table as checkable when its first header cell is `prop`, `field`, `option` or `method`. The token table's first header is `Token`, so none of the four checks touch it. Measured against `contract.test.ts`:

- **11 tokens are undocumented:** `--pretable-bg-pinned`, `--pretable-bg-group-row`, `--pretable-radius-control`, `--pretable-shadow-overlay`, `--pretable-shadow-card`, `--pretable-seam-color`, `--pretable-icon-size`, `--pretable-positive`, `--pretable-negative`, `--pretable-warning`, `--pretable-info`.
- **1 documented token no longer exists:** `--pretable-reorder-ghost-shadow`, renamed to `--pretable-shadow-overlay`.
- The page states **39** in its frontmatter, its intro, and its "the other 36 are CSS-only" line. The real count is **49**.

**Six pages still present a two-theme world.** `index.mdx`, `pick-a-theme.mdx`, `override-tokens.mdx`, `custom-themes.mdx`, `light-dark.mdx` and `tailwind-css-in-js.mdx` all tell readers to choose between Excel and Material. `pretable.css` shipped as the house theme and the marketing site itself runs it.

**Material's documented values are stale** — the audit that preceded this found roughly fifteen wrong, including an accent documented as `#6750a4` against a shipped `#0061a4`.

---

### Task 1: Teach the guard to see the token table

This comes first on purpose. Write the guard, watch it fail against today's docs, and let its failures drive the content fixes — rather than fixing prose by hand and hoping it is complete.

- [ ] **Step 1: Add the check**

In `apps/website/lib/docs/__tests__/docs-api-surface.test.ts`, add a check that reads the `TOKENS` array from `packages/ui/src/__tests__/contract.test.ts` and every `` `--pretable-*` `` occurrence in `theming/token-reference.mdx`, then asserts **both directions**: no contract token is undocumented, and no documented token is absent from the contract.

Match the file's existing voice — its header comment explains *why* each check exists, in terms of the incident it would have caught. Yours has one: eleven tokens went undocumented and a renamed one lingered, because the table's first header is `Token` and the member-table detector only fires on `prop`/`field`/`option`/`method`.

Fail closed, like everything else here: an unreadable contract file is a failure, not a skip.

- [ ] **Step 2: Add a literal-value check, conservatively**

For each theme column in the table, compare documented **literal hex values** against the theme's actual declaration in `packages/ui/src/themes/<theme>.css`. Skip any declaration whose value is a `var()` reference, a `color-mix()`, or otherwise not a plain literal — those are not worth the parsing risk and a false failure here is worse than no check.

This is what catches the stale Material column.

- [ ] **Step 3: Run it and record what fails**

`pnpm --filter @pretable/app-website test -- docs-api-surface`

Expect failures for the 11 missing, the 1 phantom, and however many stale values Step 2 finds. **Report the full list** — the value failures are the interesting ones, since nobody has counted them precisely.

- [ ] **Step 4: Commit the guard alone**, failing, so the diff shows it catching real drift before anything is fixed: `test(website): pin the token reference to the token contract`.

If committing a failing test is awkward for CI, commit it together with Task 2 instead and say so.

---

### Task 2: Fix the token reference

- [ ] **Step 1:** Add the 11 missing tokens with description, type, and per-theme values read from the theme files — not invented.
- [ ] **Step 2:** Replace `--pretable-reorder-ghost-shadow` with `--pretable-shadow-overlay`, and say in prose that it was renamed because four of its five uses were popovers rather than drag ghosts.
- [ ] **Step 3:** Correct every count. Frontmatter, intro, and the "CSS-only" split. The three JS-read height tokens claim needs re-checking against `packages/ui/src/density.ts` rather than copied forward.
- [ ] **Step 4:** Add a `pretable` column to the table, since it is now the default and readers will look for it first. Consider making it the **first** theme column for that reason.
- [ ] **Step 5:** Fix the stale Material values the guard flagged.
- [ ] **Step 6:** The guard passes. Commit as `docs(theming): bring the token reference back in line with the contract`.

---

### Task 3: Make `pretable.css` the documented default

Across `index.mdx`, `pick-a-theme.mdx`, `override-tokens.mdx`, `custom-themes.mdx`, `light-dark.mdx`, `tailwind-css-in-js.mdx`:

- [ ] **Step 1:** `pretable.css` is the recommended import in every getting-started snippet. Excel and Material are reframed as **compatibility skins** — imitations meant to disappear into a host design system, which is still a real reason to pick one. Do not disparage them.
- [ ] **Step 2:** `pick-a-theme.mdx` needs the most work: it is structured as a two-way choice and becomes a three-way one with a clear default. Lead with why the house theme is the default — the grid paints its own inset canvas, because it never paints the host's page, which is what lets its rules stay hairlines.
- [ ] **Step 3:** `light-dark.mdx` — Excel remains light-only; Material and `pretable` both have dark blocks. Check what the page currently claims before editing.
- [ ] **Step 4:** Verify every fenced code block still imports names that exist. The guard's import check covers `@pretable/*` identifiers and will fail otherwise.
- [ ] **Step 5:** Commit as `docs(theming): make pretable.css the documented default`.

---

### Task 4: Verification

- [ ] `pnpm --filter @pretable/app-website test` — the docs guard and everything else.
- [ ] `pnpm typecheck`, `pnpm lint`, `pnpm format`.
- [ ] Build the site and **read the rendered theming section** — tables render, no broken MDX, no orphaned references to the removed token.
- [ ] Website e2e. Use the ROOT playwright binary from **inside `apps/website`** — running it from the repo root with `--config` fails identically to the stale local shim. Serve a production build and pass `BASE_URL`.

## Self-review

**The guard comes first because the content fix is otherwise unverifiable** — "did I get all 49?" is exactly the question a machine should answer.

**Scope held deliberately:** the new cell presentations (`PretableDelta`, `PretableStatus`, `PretableBadge`, `PretableEntity`) are public and undocumented, but documenting them means new prop tables, which the roster will demand be registered against their types. That is a separate, well-defined piece of work and mixing it in would make this sweep hard to review.
