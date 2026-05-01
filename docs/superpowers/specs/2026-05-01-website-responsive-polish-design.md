# Website Responsive Polish — Design Spec

**Date:** 2026-05-01
**Status:** Draft for review
**Scope:** `apps/website` only. Three small polish fixes surfaced by a desktop + mobile (390px) responsive review.

---

## 1. Goal

Phase 4 (docs surface) shipped a responsive site. A subsequent visual review at 390px viewport surfaced three minor UX/visual gaps:

1. Docs sidebar `<summary>` shows the default browser disclosure marker (▼), inconsistent with the cool-slate visual system.
2. Docs sidebar is always expanded on mobile (`<details open>`), pushing content ~80px down on every load. With one item today this is fine; with growth it gets worse.
3. Body section vertical padding is `py-24` at mobile (96px top + 96px bottom). On 844px-tall mobile viewports this eats above-the-fold density without serving the design intent.

This spec proposes three targeted fixes. No rebuild, no new tokens, no architecture changes.

## 2. Non-goals

- Touching `@pretable/ui` (the package's `<Nav>`/`<Footer>` already have correct mobile rules).
- Changing the docs sidebar information architecture or `_nav.ts` shape.
- New typography or color tokens.
- Refactoring `<details>` into a JS-controlled disclosure component.
- Touching desktop layout (only mobile-only padding adjustments).

## 3. Architecture

### 3.1 Custom disclosure marker

Today: `<DocsSidebar>` wraps content in `<details open>` with a `<summary>` styled as mono-uppercase "Documentation". The default browser triangle marker prefixes the text.

Fix: hide the native marker, prepend a custom marker styled with the site's mono font + accent color. The marker rotates on open/closed state via CSS:

- closed → `›` (right-pointing chevron)
- open → `⌄` (down-pointing chevron) — implemented as a single character + CSS `transform: rotate()` on the `[open]` state of the parent `<details>`

**Implementation:** an inline `<span aria-hidden>` inside the `<summary>` plus CSS to:

- Hide the UA marker via `summary::-webkit-details-marker { display: none; }` and `summary { list-style: none; }` (covers Firefox + Chromium).
- Style the custom span with cool-slate accent color and mono font.
- Rotate the marker 90° when `details[open]`.

This stays a server component — pure CSS, no JS.

### 3.2 Mobile-default collapsed sidebar

Today: `<details open>` keeps the sidebar expanded. On desktop `<summary>` is hidden via `md:[&>summary]:hidden`, and the `[open]` state is necessary so children render.

Problem: on mobile, users see the full sidebar before the content.

Fix: drop the `open` attribute. Use a CSS override to **force the children visible on desktop regardless of `open` state**. Pattern:

```css
@media (min-width: 768px) {
  details > nav,
  details > div {
    display: block !important;
  }
}
```

(In Tailwind v4 syntax: `md:[&_>nav]:!block`. Or — cleaner — an explicit class targeted via `md:hidden` on the `<details>` host trick.)

The cleanest variant that avoids `!important`: split the markup so the `<summary>` and the toggle logic only render at mobile (`<= md`), and the desktop view bypasses `<details>` entirely. Two small tradeoffs:

**Option A** — keep single `<details>`, add CSS override (easy, one-line).
**Option B** — render `<details>` on mobile, plain `<aside>` on desktop, switching via Tailwind `md:` classes (more code, cleaner semantics).

**Recommendation: Option A.** One CSS override, no DOM duplication, server-component friendly. The `!important` is bounded to a single rule and well-scoped.

### 3.3 Body section mobile padding

Today: `<Problem>`, `<Solution>`, `<ReceiptsBand>`, `<ComparisonTable>`, `<FeatureGrid>`, `<CodeExample>`, `<CtaSection>` use `px-7 py-24 md:px-10 md:py-28`.

Mobile reads padding-heavy: 96px top + 96px bottom on 844px-tall viewports = 192px vertical chrome per section.

Fix: drop mobile vertical padding to `py-16` (64px). Desktop stays `md:py-28` (112px). Net: section header arrives ~32px sooner above the fold on each scroll-revealed section, which materially improves mobile pacing without touching desktop.

**Excluded:** `<Hero>` (uses `py-24 md:py-32 lg:py-40` — already designed for above-the-fold scale; tightening would compress the Fraunces headline awkwardly), and `<PlaygroundSection>` (no top/bottom padding, just the grid surface).

## 4. File structure

**Modified:**

- `apps/website/app/components/DocsSidebar.tsx` — drop `open` attribute, replace `<summary>` text with a span+marker, restructure for the CSS open-state target.
- `apps/website/app/components/Problem.tsx` — `py-24 md:py-28` → `py-16 md:py-28`.
- `apps/website/app/components/Solution.tsx` — same change.
- `apps/website/app/components/ReceiptsBand.tsx` — `py-[52px]` already; check whether to leave as-is. Keeping the existing tighter band padding (already smaller than 24).
- `apps/website/app/components/ComparisonTable.tsx` — `py-24 md:py-28` → `py-16 md:py-28`.
- `apps/website/app/components/FeatureGrid.tsx` — same.
- `apps/website/app/components/CodeExample.tsx` — same.
- `apps/website/app/components/CtaSection.tsx` — same.
- `apps/website/app/components/DocsSidebar.tsx` (already in list) — gets the marker + collapsed-by-default change.

**Untouched:**

- `<Hero>` (`py-24 md:py-32 lg:py-40` stays).
- `<PlaygroundSection>` (no padding to change).
- `<Nav>`, `<Footer>` (in `@pretable/ui` package — out of scope).
- Globals, tokens, MDX pipeline.

**No new files.**

## 5. Testing strategy

The existing `DocsSidebar` test asserts (a) one heading per `_nav` section, (b) one link per item, (c) `<nav>` has `aria-label="Docs"`. None of these assertions break with the marker change.

The `<details>` `open` removal does change one observable: in the test's render, the children of `<details>` render regardless of `open` state because jsdom defaults to "rendered but visually hidden" for `<details>` (jsdom doesn't run UA stylesheet `display:none` rules the same way real browsers do). This means the existing assertions continue to pass.

New tests:

- One assertion in `DocsSidebar.test.tsx` confirming the `<summary>` exists and contains an `aria-hidden` marker span.

No tests for the padding changes — they're whitespace-only and don't change DOM structure.

Total website tests after change: 23 (unchanged) + 1 marker assertion = **24**.

## 6. Verification (multiple passes)

- **Pass 1** — implement; run `pnpm --filter @pretable/app-website test/typecheck/lint/build/format`. Boot dev server.
- **Pass 2** — visual smoke at 1440px (desktop) for `/`, `/docs`, `/docs/getting-started`. Confirm no regression: nav highlight still works, sidebar still sticky on desktop, body section spacing still feels right.
- **Pass 3** — visual smoke at 390px (mobile, via iframe). Confirm: docs sidebar starts collapsed; tap to expand works; custom marker rotates; body sections feel tighter (less padding-heavy) without crowding.
- **Pass 4** — re-iterate if any pass surfaces an issue. Multiple passes per the user's request.

## 7. Out of scope

- Hamburger overlay nav.
- TOC pane on docs.
- Theming consumer-overrides.
- Padding-token refactor.

## 8. Rollback

Revert the squash-merge commit. Pure CSS + JSX changes; no migration.

## 9. Risks

- **CSS `!important`**: needed for option A. Bounded to one rule. Future maintainers reading the file will see a comment explaining why.
- **Hidden marker compatibility**: `summary::-webkit-details-marker` + `list-style: none` covers Chromium and Firefox; Safari obeys the standard `list-style` and modern marker pseudo. Verified pattern.
- **Test sensitivity to DOM structure**: existing tests count `<a>` tags and `<h3>` headings. The marker is a `<span>` — does not affect those counts.

## 10. Success criteria

- [ ] Docs sidebar `<summary>` shows custom marker (no native ▼); marker rotates on open/closed state.
- [ ] On mobile, sidebar is collapsed on first paint; tap expands.
- [ ] On desktop, sidebar content always visible (regardless of internal `<details>` state).
- [ ] All seven body sections show tighter mobile padding; desktop unchanged.
- [ ] 24 website tests pass.
- [ ] CI green.
- [ ] Single PR.
