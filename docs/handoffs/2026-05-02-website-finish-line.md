# Pretable Website Redesign — Finish-Line Handoff

You are taking over a marketing-site redesign that shipped to production but is **broken in real browsers**. CI was green; manual UI walkthrough was skipped. Your job is to fix the structural bugs, do the visual and cross-browser validation that should have happened before merge, and ship the result correctly. Definition of done: pretable.ai works in Chrome, Safari, iOS Safari, and Firefox at desktop and mobile widths, with the streaming hero demo actually demonstrating the wedge (1k events/sec, wrapped multilingual text, no console errors, drawer pulls up and reveals the marketing arc).

Read this entire document before touching code. There are non-obvious traps from the last attempt — most of them caused by skipping visual validation in favor of merging on CI green.

---

## 1. Where you are

- **Repo:** `/Users/blove/repos/pretable` (cacheplane/pretable on GitHub)
- **Worktree to use:** `/Users/blove/repos/pretable/.worktrees/website-redesign`
  - Currently on `main` (post-merge state of PR #62)
  - **Has uncommitted local changes from the previous session** — review with `git status` and `git diff` before doing anything destructive
- **Production:** https://pretable.ai (Vercel auto-deploys from `main`)
- **Local dev:** `pnpm install && pnpm --filter @pretable/app-website dev` from the worktree → http://localhost:3000

**Verify your location** before any `git` command:

```bash
pwd && git branch --show-current
```

Expected: `/Users/blove/repos/pretable/.worktrees/website-redesign` and `main`.

**Verify install is fresh** (post-merge worktrees often need this):

```bash
pnpm install --frozen-lockfile
pnpm -r build  # ensure all internal package dists exist
```

---

## 2. Project conventions you must respect

- **pnpm 10 monorepo.** Workspace deps use `workspace:*`.
- **packages/\* is vanilla CSS only.** Tailwind v4 is allowed only in `apps/website`. (Source: project memory `feedback_styling_split.md`.)
- **Light mode is the default.** The Alpenglow palette in `packages/ui/src/tokens.css` defines 41 tokens.
- **Don't push to `main` directly.** Always PR with CI green, squash-merge.
- **Don't `--no-verify`** to bypass pre-commit hooks. Fix what they catch.
- **Don't skip pre-commit signing** unless explicitly authorized.
- **Don't bundle unrelated work** into the fix PR. Cosmetic palette tweaks discovered during validation are in scope; refactoring `PretableSurface` internals beyond what's required to stabilize the telemetry callback is out of scope.
- **Verify branch state** before destructive ops (`reset --hard`, `checkout --`, `clean -f`, `branch -D`). The worktree already has uncommitted changes — don't blow them away without checking what they are.
- **Always commit through `git commit` (not `--amend`).** New commit per logical change.
- **packages/ public packages** (`@pretable/core`, `@pretable/react`, `@cacheplane/json-stream`) ship via npm trusted publishing. Don't change their public API as part of this work.

---

## 3. What shipped (PR #62, already merged to main)

The marketing landing page was redesigned. The live data grid IS the hero (full-bleed `<HeroGrid>` taking 100vh). A bottom drawer was meant to overlay the page above 768px and render inline as natural scroll below 768px. The visual system is the **Alpenglow palette** — warm cream `#fefcf9`, dusk peach `#ea580c`, cobalt `#1d4ed8`, dark slate `#1e293b` — inspired by Bend, OR and skiing. Trail-difficulty markers (green/blue/black/double-black SVGs) appear as cognitive-complexity signals in the comparison table and feature grid. A cascade silhouette + chairlift footer ("Built in Bend, OR.") sits at the page bottom.

**Key new files:**

- `apps/website/app/page.tsx` — assembled layout (currently broken — see §5 Bug 1)
- `apps/website/app/layout.tsx` — root layout, holds `<RouteAwareNav>` for ALL routes (post-merge it no longer takes a `version` prop and no longer renders `<Footer>`)
- `apps/website/app/components/HeroGrid.tsx` — wraps `PretableSurface`, animates a streaming event log via `requestAnimationFrame`
- `apps/website/app/components/heroGrid/eventLog.ts` — 110 canned events with multilingual messages every ~10 rows (French, Spanish, Japanese, Chinese, Russian)
- `apps/website/app/components/heroGrid/replay.ts` — rate-limited emitter (`createHeroReplay({ ratePerSec, onEmit })`)
- `apps/website/app/components/heroGrid/heroGrid.module.css` — hero CSS module
- `apps/website/app/components/Drawer.tsx` — currently renders `.drawer-wrap > .drawer-content`
- `apps/website/app/components/DrawerHandle.tsx` — currently a sibling of `<Drawer>` in `page.tsx` (this is the structural bug, see §5 Bug 1)
- `apps/website/app/components/useDrawer.ts` — state machine (open/closed, viewport-gate, hash-link, popstate, Escape)
- `apps/website/app/components/TrailMarker.tsx` — 4 variants
- `apps/website/app/components/MountainFooter.tsx` — Cascade silhouette + chairlift
- `apps/website/app/globals.css` — drawer CSS-upgrade rules under `html[data-drawer]`
- `packages/ui/src/tokens.css` — 41 Alpenglow tokens, imported by `apps/website/app/globals.css`

**Spec:** `docs/superpowers/specs/2026-05-02-website-grid-as-hero-design.md`
**Plan:** `docs/superpowers/plans/2026-05-02-website-grid-as-hero.md`
**Merged PR:** https://github.com/cacheplane/pretable/pull/62

The "DOM-first + CSS upgrade" pattern (Spec §Drawer mechanism) is critical: the marketing content is always rendered server-side. JavaScript only flips `<html data-drawer="closed">` on hydration, and CSS reacts to that attribute by transforming the `.drawer-wrap` element from `position: static` (mobile, natural-flow) to `position: fixed; bottom: 0; transform: translateY(calc(100% - 56px))` (desktop, peeking overlay). Sliding open zeroes the transform. This means SEO crawlers see all content, and reduced-motion / no-JS users get a normal scroll page.

---

## 4. The product wedge — keep this in mind while fixing

Pretable's claim is **"the first grid that treats scroll as a first-class feature"** with **wrapped text, no jank, sustained streaming from 100 to 25,000 updates/sec, 9.3ms p95 frame time**. The hero demo IS the proof:

- 1000 rows/sec emitting from a canned multilingual event log
- The `message` column has `wrap: true` — multi-line cells, variable row heights
- `PretableSurface` measures wrapped row heights and reconciles them; this is why we beat AG Grid Community 4× on the comparative bench

**Do not "fix" the Safari crash by neutering the demo.** Lower bound: 250 events/sec, with `wrap: true`. Anything below that and the marketing claim is a lie. The user already temporarily lowered the rate to 30/sec and removed `wrap: true` to keep Safari from crashing — your job is to find the real root cause so we can restore both.

---

## 5. Known bugs you must fix

### Bug 1 — Drawer architecture (HIGH, blocks the whole page UX)

**Symptom:** Homepage looks empty below the hero. Drawer doesn't open. Marketing content is unreachable.

**Root cause:** In `apps/website/app/page.tsx`, `<DrawerHandle>` and `<Drawer>` are siblings:

```tsx
<HeroGrid />
<DrawerHandle />     {/* sibling 1 */}
<Drawer>             {/* sibling 2 — gets position: fixed bottom */}
  <ReceiptsBand />
  ...
</Drawer>
```

The CSS upgrade in `globals.css` only pulls `.drawer-wrap` (rendered inside `<Drawer>`) out of flow:

```css
html[data-drawer] .drawer-wrap {
  position: fixed;
  bottom: 0;
  ...
  transform: translateY(calc(100% - 56px));
}
```

So on desktop:

- The drawer body floats at the bottom of the viewport with a 56px peek visible
- `<DrawerHandle>` stays in document flow as a separate element after the 100vh hero — it's nowhere near the bottom of the viewport
- The 56px peek the user sees is the drawer-content's sticky header (close button + "Why pretable" eyebrow), not a clickable handle
- All 6 marketing sections (ReceiptsBand, ComparisonTable, HowItWorks, CodeExample, FeatureGrid, CtaSection) live inside the unreachable overlay
- Below the hero, the user sees: empty space (where `.drawer-wrap` used to be in flow before the upgrade) → MountainFooter

**Fix:** nest `<DrawerHandle>` inside `<Drawer>` so they share `.drawer-wrap` and slide together. The handle becomes the peek bar by definition. Remove the standalone `<DrawerHandle />` from `page.tsx`.

Target shape:

```tsx
// apps/website/app/components/Drawer.tsx
export function Drawer({ children }: DrawerProps) {
  const { close } = useDrawer();
  return (
    <div className="drawer-wrap" data-testid="drawer">
      <DrawerHandle /> {/* 56px tall, the peek */}
      <div
        aria-label="More about pretable"
        className="drawer-content overflow-y-auto bg-bg-page"
        id="drawer-content"
        role="region"
      >
        {/* drop the sticky header that duplicates the handle's purpose;
            close button can move into the handle when isOpen is true */}
        {children}
      </div>
    </div>
  );
}

// apps/website/app/page.tsx
export default function HomePage() {
  return (
    <>
      <main>
        <HeroGrid />
        <Drawer>
          <ReceiptsBand />
          <ScrollReveal>
            <ComparisonTable />
          </ScrollReveal>
          <ScrollReveal>
            <HowItWorks />
          </ScrollReveal>
          <ScrollReveal>
            <CodeExample />
          </ScrollReveal>
          <ScrollReveal>
            <FeatureGrid />
          </ScrollReveal>
          <ScrollReveal>
            <CtaSection />
          </ScrollReveal>
        </Drawer>
      </main>
      <MountainFooter />
    </>
  );
}
```

**Mobile (<768px):** continues to work because `.drawer-wrap` keeps `position: static` and `useDrawer` doesn't write `data-drawer` (the viewport-width gate at `useDrawer.ts:29-31`). Handle and content render inline.

**CSS:** the `globals.css` rules already key off `html[data-drawer]` — no change needed there. You may want to verify the peek height (56px in the existing transform) matches the new handle's actual rendered height; adjust either the handle padding or the transform value if not.

**Tests to update:**

- `apps/website/app/components/__tests__/Drawer.test.tsx` — Drawer now renders a DrawerHandle internally; assert `data-testid="drawer-handle"` is queryable inside the Drawer
- `apps/website/app/components/__tests__/useDrawer.test.ts` — should still pass (it tests the hook, not the structure)
- `apps/website/e2e/smoke.spec.ts` — already asserts `[data-testid='drawer-handle']` is visible; this should still hold

### Bug 2 — Safari render loop kills the tab (HIGH)

**Symptom:** Loading the page in Safari (and iOS Safari) crashes the tab. Chrome shows the same error in the console but doesn't necessarily kill the tab.

**Console message:**

```
Uncaught Error: Maximum update depth exceeded. This can happen when a component
repeatedly calls setState inside componentWillUpdate or componentDidUpdate.
React limits the number of nested updates to prevent infinite loops.
```

**Root cause:** `PretableSurface` (in `packages/react-surface/src/pretable-surface.tsx:205-207`) has:

```ts
useLayoutEffect(() => {
  onTelemetryChange?.(telemetry);
}, [onTelemetryChange, telemetry]);
```

`HeroGrid.tsx` passes `onTelemetryChange` as an inline arrow:

```tsx
onTelemetryChange={(t) => { telemetryRef.current = t; }}
```

A new function reference is created every render. The effect refires every render. Combined with PretableSurface's other measurement effects (`setMeasuredHeights`, `setViewportWidth`) and the rAF-driven `setRows` loop in HeroGrid, the work-loop never converges and React bails out with "Maximum update depth exceeded".

**Fix in `HeroGrid.tsx`:** stabilize the callback. Two acceptable approaches:

```ts
// Option A — drop it entirely (we don't read telemetry anywhere yet)
<PretableSurface
  ariaLabel="Pretable streaming demo"
  columns={columns}
  getRowId={(row: DisplayRow) => row.id}
  rows={rows}
  viewportHeight={520}
/>

// Option B — useCallback with empty deps
const onTelemetryChange = useCallback((t: PretableTelemetry) => {
  telemetryRef.current = t;
}, []);
```

Recommend Option A unless you're using telemetry for something. Option B if you need telemetry available for instrumentation later.

**After fixing the loop, restore the demo:**

- `RATE_PER_SEC = 1000` (was lowered to 30 as a workaround)
- `wrap: true` on the `message` column (was removed as a workaround)
- Keep the per-frame batching that's already in HeroGrid (`pending: DisplayRow[]` flushed once per rAF). That alone is correct — the bug is in the telemetry callback, not the batching.
- Optional: seed initial rows (~30) so the grid isn't blank for the first second after hydration. Sample from `heroEventLog.slice(0, 30)`.

**Verify in Safari** (real, not jsdom) that no "Max update depth" appears in the console for at least 30 seconds of runtime.

**Existing related fix:** the previous round added a `-webkit-backdrop-filter` prefix to `apps/website/app/components/heroGrid/heroGrid.module.css`. Keep it — it's a real Safari < 18 compatibility issue independent of the loop bug.

### Bug 3 — Visual validation never happened (MEDIUM)

CI passes test/typecheck/lint/format/build/packaging. None of those exercise visual rendering. The previous round merged on green without ever opening the page in a real browser. The following are still unvalidated:

- Drawer interaction (peek height, slide animation, hero brightness fade, Esc, browser back, hash deep-link `/#receipts`)
- Mobile (<768px) inline-flow fallback — drawer should render as natural scroll, not overlay
- Trail markers' visual rhythm in `ComparisonTable` (4 column headers) and `FeatureGrid` (4 cards)
- `MountainFooter` SVG rendering at all widths (especially below 480px)
- Drawer marketing content under the new palette — `ReceiptsBand` consolidated 3 components into one section, `CtaSection` was reduced to install + GitHub, `HowItWorks` and `CodeExample` had palette swaps. None visually verified.
- `/docs` route under the layout-level `<RouteAwareNav>` (no `version` prop, no `<Footer>`) — does it still look right?
- `prefers-reduced-motion` path — hero should show static 50-row snapshot, drawer slide should be off

This isn't a single bug; it's a process gap. Walk the matrix in §7.

### Bug 4 — `CtaSection` `sr-only` workaround (LOW)

The previous round used a visually-hidden `<p className="sr-only">npm install @pretable/react</p>` to satisfy a `getByText("npm install @pretable/react")` test assertion while still rendering the install line via `<CopyCommand>` (which prefixes `$ ` to the displayed text). It's a slight stretch but not blocking. File a follow-up issue if you want to clean it up — either patch `CopyCommand` to accept a `prefix` prop (default `"$ "`, allow override to `""`), or change the test to match the prefixed text.

---

## 6. Phased plan

### Phase 1 — Triage existing worktree state

1. `cd /Users/blove/repos/pretable/.worktrees/website-redesign`
2. `git status` and `git diff`. Identify uncommitted changes. Likely contains:
   - `RATE_PER_SEC = 30` in `HeroGrid.tsx` (user's manual workaround)
   - Removed `wrap: true` on the `message` column (user's manual workaround)
   - Possibly other ad-hoc fixes
3. **Decide:** revert these workarounds before starting (you'll restore them in Phase 2 once Bug 2 is fixed), OR keep them as a checkpoint commit on the new branch and rewrite later. Recommend reverting — the workarounds aren't useful once the root cause is fixed.

### Phase 2 — Fix Bug 1 + Bug 2 on a new branch

1. `git checkout -b fix/website-drawer-and-hero-loop`
2. Fix Bug 1 (drawer structure):
   - Modify `Drawer.tsx` to nest `<DrawerHandle />` inside `.drawer-wrap`
   - Remove the duplicate sticky-header close button (the handle replaces that role)
   - Modify `page.tsx` to drop the standalone `<DrawerHandle />`
   - Update `Drawer.test.tsx` to assert handle is inside drawer
   - Run `pnpm --filter @pretable/app-website test`. Must be green.
3. Fix Bug 2 (telemetry callback):
   - Drop `onTelemetryChange` from `HeroGrid.tsx` (Option A) or stabilize with `useCallback` (Option B)
   - Restore `RATE_PER_SEC = 1000`
   - Restore `wrap: true` on the message column
   - Optional: seed initial rows
   - Run tests again. Green.
4. Boot the dev server: `pnpm --filter @pretable/app-website dev`
5. Open http://localhost:3000 in Chrome AND Safari. Verify:
   - Hero renders with rows actually streaming (not blank, not stalled)
   - **No console errors** (open Safari Web Inspector with Cmd-Opt-I)
   - DrawerHandle peeks at the bottom of the viewport at desktop widths
   - Click handle → drawer slides up; click "✕ close" or press Esc → drawer slides down
   - Browser back button closes drawer (without leaving the page)
   - `/#receipts` deep-link opens the drawer on load
   - Drawer content sections (ReceiptsBand, ComparisonTable, HowItWorks, CodeExample, FeatureGrid, CtaSection) all render and are scrollable inside the drawer

### Phase 3 — Cross-browser + responsive validation matrix

This is the validation the previous round skipped. Use headed Playwright (`webkit`, `chromium`, `firefox` projects) and/or real browsers. Install WebKit if not already: `pnpm --filter @pretable/app-website exec playwright install webkit`.

Walk this matrix:

| Viewport (W×H)                                    | Engine(s)                   | What to verify                                                                                                                                       |
| ------------------------------------------------- | --------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| 320×568 (iPhone SE)                               | webkit                      | Below-768 inline scroll, NO overlay drawer, hero grid horizontal-scrolls inside its frame (NO page-level horizontal overflow), nav fits without wrap |
| 375×667 (iPhone 8)                                | webkit + chromium           | Same                                                                                                                                                 |
| 390×844 (iPhone 14)                               | webkit                      | Same                                                                                                                                                 |
| 768×1024 (iPad portrait — exactly the breakpoint) | webkit                      | Pick a side (`>= 768` upgrades per `useDrawer.ts:30`). Document and verify either side works                                                         |
| 1024×768 (iPad landscape)                         | webkit + chromium           | Drawer overlay active, peek visible at bottom, slide works smoothly                                                                                  |
| 1280×800 (small laptop)                           | webkit + chromium + firefox | Same                                                                                                                                                 |
| 1920×1080 (desktop)                               | chromium + firefox          | Same                                                                                                                                                 |

For each cell:

- Capture a screenshot
- List any visual issues (clipped text, overflow, unstyled element, palette inconsistency, broken motif)
- Confirm zero JS errors during a 5-second observation. Listen for `pageerror` and `console` events with level=error.

Also verify:

- **macOS Reduce Motion** (System Settings → Accessibility → Display → Reduce Motion). Reload. Hero should show a static 50-row snapshot (the early-return branch in `HeroGrid.tsx:46-55`); drawer slide should be disabled (CSS at `globals.css` `@media (prefers-reduced-motion: reduce)`).
- **Drawer keyboard navigation:** Tab from cold load. Order should be: nav links → drawer handle → drawer content (when open). The handle has `aria-expanded="true|false"` toggling correctly, `aria-controls="drawer-content"`.
- **Trail markers** have descriptive `aria-label` attributes (already covered by unit tests, but confirm in DOM).
- **`@axe-core/playwright`** on `/` and `/docs`. Triage violations; fix anything serious. Add to dev deps if not present: `pnpm --filter @pretable/app-website add -D @axe-core/playwright`.

If a finding is purely cosmetic (palette tweak, spacing), fix it inline. If it's structural (e.g., `MountainFooter` SVG breaks at 320px in a way that needs a viewBox change), file a follow-up issue and link from the PR.

Write a small Playwright spec under `apps/website/e2e/` that automates the 5-second-no-error observation across all three engines and the listed viewports. Run it: `pnpm --filter @pretable/app-website exec playwright test --project webkit` etc.

### Phase 4 — Open PR, merge, validate production

1. Open PR titled `fix(website): drawer structure + Safari render loop + visual validation`
2. PR body must include:
   - Bug 1 root-cause analysis (3-4 sentences) + the diff
   - Bug 2 root-cause analysis (3-4 sentences) + the fix + Safari console clean confirmation
   - The cross-browser matrix from Phase 3 with pass/fail per cell
   - Before/after Safari screenshots at 1280×800 and 375×667
   - Any cosmetic fixes you applied during validation, with rationale
   - Any follow-up issues you filed with links
3. Watch CI: `gh pr checks <num> --watch`
4. **Do not merge until Phase 3 evidence is in the PR body.** Self-review: would another developer be able to retrace your validation from the PR alone?
5. Merge on green: `gh pr merge <num> --squash --delete-branch`
6. Watch deploy: `gh run watch` or the Vercel dashboard
7. Once live, re-run a smaller cross-browser smoke against `https://pretable.ai`:
   - WebKit + Chromium headed Playwright at 1280px and 375px
   - `/` and `/docs` both 200 OK
   - No console errors during 5-second observation
   - Compare body of `https://pretable.ai` and `https://pretable.vercel.app` (curl + diff/sha256) — they should match
8. Lighthouse on `pretable.ai` (mobile + desktop). Target: Performance ≥ 80, Accessibility ≥ 95, Best Practices ≥ 90, SEO ≥ 95. Note any regressions vs main pre-merge if you can pull a baseline.
9. If anything regresses, file a hotfix immediately. Do not leave production broken overnight.

---

## 7. Test commands cheat sheet

From the worktree root unless noted:

```bash
# Install + build internal packages
pnpm install --frozen-lockfile
pnpm -r build

# Website unit tests (jsdom, Vitest)
pnpm --filter @pretable/app-website test

# A specific test file
pnpm --filter @pretable/app-website test -- HeroGrid
pnpm --filter @pretable/app-website test -- Drawer

# Typecheck
pnpm --filter @pretable/app-website typecheck

# Lint
pnpm --filter @pretable/app-website lint

# Format (write)
pnpm format:write
# Format (check)
pnpm format

# Build
pnpm --filter @pretable/app-website build

# Dev server (http://localhost:3000)
pnpm --filter @pretable/app-website dev

# Playwright e2e (existing smoke spec)
BASE_URL=http://localhost:3000 pnpm --filter @pretable/app-website smoke

# Install WebKit + Firefox engines for cross-browser
pnpm --filter @pretable/app-website exec playwright install webkit firefox

# Packaging gates (publint + attw on public packages)
pnpm -r --filter '@pretable/{core,react}' --filter '@cacheplane/json-stream' lint:packaging
```

---

## 8. Constraints and red lines

- **Do not ship at `RATE_PER_SEC < 250`** unless you have written documentation in the PR body for why the higher rate truly cannot be made stable.
- **Do not drop `wrap: true`** from the message column. Multilingual wrapped scroll IS the wedge.
- **Do not disable the streaming demo** as a workaround. Fix root causes.
- **Do not push to `main`** directly.
- **Do not skip pre-commit hooks.**
- **Do not refactor `PretableSurface` internals** beyond what's needed to stabilize the telemetry callback. If you find other bugs in `packages/react-surface/`, file a follow-up issue.
- **Do not modify `packages/*` to use Tailwind.** Vanilla CSS only there.
- **Do not bundle unrelated cleanups.** This PR is the drawer fix + Safari fix + validation. Anything else gets a follow-up.
- **Real-browser-tested before merge.** This is non-negotiable. Document the manual walkthrough in the PR body. The previous round's failure was shipping CI-green but UI-broken; do not repeat it.

---

## 9. Reference materials

- Spec: `docs/superpowers/specs/2026-05-02-website-grid-as-hero-design.md`
- Plan: `docs/superpowers/plans/2026-05-02-website-grid-as-hero.md`
- Previous PR (the broken one): https://github.com/cacheplane/pretable/pull/62
- Memory index: `~/.claude/projects/-Users-blove-repos-pretable/memory/MEMORY.md`
- Vercel CI deploy pattern: `~/.claude/projects/-Users-blove-repos-pretable/memory/reference_vercel_ci_pattern.md` — GH Actions owns deploys, Vercel git auto-deploy disabled, Playwright smoke gates production, sticky-comment previews on PRs
- Styling split rule: `~/.claude/projects/-Users-blove-repos-pretable/memory/feedback_styling_split.md`
- Website pivot context: `~/.claude/projects/-Users-blove-repos-pretable/memory/project_website_pivot_after_b.md`
- Website H1 evidence update: `~/.claude/projects/-Users-blove-repos-pretable/memory/project_website_h1_update.md`

---

## 10. Final report format

When done, post a single message containing:

1. **Bug 1 fix** — one-sentence root cause + diff stat + a screenshot (or text description) of the working drawer at desktop width
2. **Bug 2 fix** — root cause one-paragraph + the actual code change + Safari console clean confirmation
3. **Validation matrix** — table from Phase 3 with pass/fail per cell, axe results, reduced-motion result
4. **Production validation** — Lighthouse mobile + desktop scores, body-hash comparison of pretable.ai vs vercel.app
5. **PR link** — the merged URL
6. **Open issues** — anything filed as follow-ups, with GitHub issue links
7. **Production confirmation** — pretable.ai loads cleanly post-deploy, screenshot at 1280px and 375px

Keep it under 800 words. The diff and PR speak for themselves; the report is for the human reviewing.

---

## 11. Definition of done

A user landing on https://pretable.ai in Safari:

- Sees a streaming, wrapped-text data grid as the page hero
- Watches multi-line multilingual messages scroll smoothly at 1k events/sec
- Notices a small handle peeking at the bottom of the viewport
- Clicks the handle → drawer slides up smoothly → reveals the marketing arc (numbers, comparison, how it works, code example, features, CTA)
- Can press Esc or click close → drawer slides down → back on the hero
- Sees no console errors at any point in a 60-second observation
- Can do all of this on iPhone Safari at 375×667 with the drawer falling back to natural scroll
- Lighthouse scores are above the targets in §6 Phase 4 step 8
