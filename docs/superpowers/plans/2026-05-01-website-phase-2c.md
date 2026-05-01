# Website Phase 2.C Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add RSC smoke tests + a living visual-system README to `apps/website`, and mark the stale 2026-04-21 spec as superseded.

**Architecture:** Mirror `packages/react`'s vitest pattern (`vitest run --environment jsdom`, deps hoisted from root, `@testing-library/react` + `@testing-library/jest-dom`). One smoke test per top-level component plus the page (~12 tests). Replace `apps/website/README.md` boilerplate with a tokens / type / sections / narrative / "how to add a section" living doc. Prepend a one-line superseded banner to the old visual-system spec.

**Tech Stack:** vitest 4, @testing-library/react 16, @testing-library/jest-dom 6, jsdom 29, React 19, Next.js 16. All test deps already at the workspace root — `apps/website/package.json` only needs the `test` script and a vitest config.

---

## File Structure

**Created:**

- `apps/website/vitest.config.ts` — minimal vitest config (no aliases needed; website imports compiled `@pretable/*` packages, not source).
- `apps/website/__tests__/setup.ts` — global `IntersectionObserver` shim (jsdom doesn't ship one) plus `@testing-library/jest-dom/vitest` import.
- `apps/website/__tests__/page.test.tsx` — `<HomePage />` renders.
- `apps/website/__tests__/components/Hero.test.tsx`
- `apps/website/__tests__/components/PlaygroundSection.test.tsx`
- `apps/website/__tests__/components/Problem.test.tsx`
- `apps/website/__tests__/components/Solution.test.tsx`
- `apps/website/__tests__/components/ReceiptsBand.test.tsx`
- `apps/website/__tests__/components/ComparisonTable.test.tsx`
- `apps/website/__tests__/components/FeatureGrid.test.tsx`
- `apps/website/__tests__/components/CodeExample.test.tsx`
- `apps/website/__tests__/components/CtaSection.test.tsx`
- `apps/website/__tests__/components/ScrollReveal.test.tsx`
- `apps/website/__tests__/components/LandingAmbient.test.tsx`

**Modified:**

- `apps/website/package.json` — add `test` script, keep deps as-is (hoisted).
- `apps/website/README.md` — replace boilerplate with living doc.
- `docs/superpowers/specs/2026-04-21-pretable-visual-system-design.md` — prepend a single status banner at the top.

---

## Task 1: Test infrastructure (vitest config, setup file, npm script)

**Files:**

- Create: `apps/website/vitest.config.ts`
- Create: `apps/website/__tests__/setup.ts`
- Modify: `apps/website/package.json`

- [ ] **Step 1: Create the vitest config**

```ts
// apps/website/vitest.config.ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    setupFiles: ["__tests__/setup.ts"],
  },
});
```

Notes:

- `--environment jsdom` is passed on the CLI (mirrors `packages/react`), not set here.
- No `resolve.alias` needed: `apps/website` imports compiled `@pretable/*` packages via workspace links, not source.
- No `@vitejs/plugin-react` needed: vitest auto-handles JSX/TSX with esbuild for these synchronous, zero-async tests.

- [ ] **Step 2: Create the test setup file**

```ts
// apps/website/__tests__/setup.ts
import "@testing-library/jest-dom/vitest";
import { vi } from "vitest";

// jsdom does not implement IntersectionObserver; ScrollReveal uses it.
class MockIntersectionObserver {
  observe = vi.fn();
  unobserve = vi.fn();
  disconnect = vi.fn();
  takeRecords = vi.fn(() => [] as IntersectionObserverEntry[]);
  root = null;
  rootMargin = "";
  thresholds = [];
}
globalThis.IntersectionObserver =
  MockIntersectionObserver as unknown as typeof IntersectionObserver;
```

- [ ] **Step 3: Add the test script to apps/website/package.json**

Read the file and add `"test": "vitest run --environment jsdom"` to the `scripts` object alongside the existing `dev`, `build`, `start`, `lint`, `typecheck`. Final scripts block:

```json
"scripts": {
  "prepare:deps": "pnpm --filter @pretable-internal/scenario-data build && pnpm --filter @pretable/react build && pnpm --filter @pretable/ui build",
  "predev": "pnpm run prepare:deps",
  "dev": "next dev",
  "prebuild": "pnpm run prepare:deps",
  "build": "next build",
  "prestart": "pnpm run prepare:deps",
  "start": "next start",
  "pretest": "pnpm run prepare:deps",
  "test": "vitest run --environment jsdom",
  "lint": "eslint app --ext .ts,.tsx",
  "typecheck": "tsc --noEmit"
}
```

The `pretest` lifecycle hook ensures `@pretable/*` packages are built before vitest tries to import them (matches `predev` / `prebuild` / `prestart`).

- [ ] **Step 4: Verify the script works (no tests yet, expect "no test files found")**

Run: `pnpm --filter @pretable/app-website test`
Expected: vitest starts up, prints something like `No test files found, exiting with code 0` OR exits 1 with a "no tests" message. Either is fine — the goal is to confirm the config loads without error. If you see a vitest config-load error, fix that before proceeding.

- [ ] **Step 5: Commit**

```bash
git add apps/website/vitest.config.ts apps/website/__tests__/setup.ts apps/website/package.json
git commit -m "test(website): add vitest config + IntersectionObserver shim"
```

---

## Task 2: Smoke test for the home page

**Files:**

- Create: `apps/website/__tests__/page.test.tsx`

- [ ] **Step 1: Write the test**

```tsx
// apps/website/__tests__/page.test.tsx
import { cleanup, render } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";

import HomePage from "../app/page";

afterEach(() => {
  cleanup();
});

it("renders the home page without crashing", () => {
  const { container } = render(<HomePage />);
  expect(container.firstChild).toBeInTheDocument();
});

it("renders content from multiple sections", () => {
  const { container } = render(<HomePage />);
  // Cheap assertion: page produces non-trivial DOM. If any section throws on
  // mount, this fails before reaching the length check.
  expect(container.textContent?.length ?? 0).toBeGreaterThan(100);
});
```

- [ ] **Step 2: Run the test**

Run: `pnpm --filter @pretable/app-website test`
Expected: 2 passing tests. If a component throws (e.g., reads `window` at module scope without a guard), this is the first place the breakage surfaces — fix the component, not the test.

- [ ] **Step 3: Commit**

```bash
git add apps/website/__tests__/page.test.tsx
git commit -m "test(website): smoke-test home page renders"
```

---

## Task 3: Smoke tests for static body sections (batch 1)

**Files:**

- Create: `apps/website/__tests__/components/Hero.test.tsx`
- Create: `apps/website/__tests__/components/Problem.test.tsx`
- Create: `apps/website/__tests__/components/Solution.test.tsx`
- Create: `apps/website/__tests__/components/CtaSection.test.tsx`

These are simple server components with hard-coded copy. Each test does one render + one DOM assertion.

- [ ] **Step 1: Hero test**

```tsx
// apps/website/__tests__/components/Hero.test.tsx
import { cleanup, render } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";

import { Hero } from "../../app/components/Hero";

afterEach(() => {
  cleanup();
});

it("renders the hero with a heading", () => {
  const { container } = render(<Hero />);
  expect(container.querySelector("h1")).toBeInTheDocument();
});
```

- [ ] **Step 2: Problem test**

```tsx
// apps/website/__tests__/components/Problem.test.tsx
import { cleanup, render } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";

import { Problem } from "../../app/components/Problem";

afterEach(() => {
  cleanup();
});

it("renders the problem section with a heading", () => {
  const { container } = render(<Problem />);
  expect(container.querySelector("h2")).toBeInTheDocument();
});
```

- [ ] **Step 3: Solution test**

```tsx
// apps/website/__tests__/components/Solution.test.tsx
import { cleanup, render } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";

import { Solution } from "../../app/components/Solution";

afterEach(() => {
  cleanup();
});

it("renders the solution section with a heading", () => {
  const { container } = render(<Solution />);
  expect(container.querySelector("h2")).toBeInTheDocument();
});
```

- [ ] **Step 4: CtaSection test**

```tsx
// apps/website/__tests__/components/CtaSection.test.tsx
import { cleanup, render } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";

import { CtaSection } from "../../app/components/CtaSection";

afterEach(() => {
  cleanup();
});

it("renders the CTA section with at least one link", () => {
  const { container } = render(<CtaSection />);
  expect(container.querySelector("a")).toBeInTheDocument();
});
```

- [ ] **Step 5: Run all tests**

Run: `pnpm --filter @pretable/app-website test`
Expected: 6 passing tests (page × 2 + 4 component tests).

- [ ] **Step 6: Commit**

```bash
git add apps/website/__tests__/components/Hero.test.tsx \
        apps/website/__tests__/components/Problem.test.tsx \
        apps/website/__tests__/components/Solution.test.tsx \
        apps/website/__tests__/components/CtaSection.test.tsx
git commit -m "test(website): smoke-test Hero, Problem, Solution, CtaSection"
```

If any of those imports fail (e.g., a section uses a named export that doesn't exist), the test surfaces it. Read the actual component source to confirm the export name; do not invent a different import shape.

---

## Task 4: Smoke tests for content-heavy sections (batch 2)

**Files:**

- Create: `apps/website/__tests__/components/ReceiptsBand.test.tsx`
- Create: `apps/website/__tests__/components/ComparisonTable.test.tsx`
- Create: `apps/website/__tests__/components/FeatureGrid.test.tsx`
- Create: `apps/website/__tests__/components/CodeExample.test.tsx`

- [ ] **Step 1: ReceiptsBand test**

```tsx
// apps/website/__tests__/components/ReceiptsBand.test.tsx
import { cleanup, render } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";

import { ReceiptsBand } from "../../app/components/ReceiptsBand";

afterEach(() => {
  cleanup();
});

it("renders the receipts band with content", () => {
  const { container } = render(<ReceiptsBand />);
  expect((container.textContent ?? "").trim().length).toBeGreaterThan(0);
});
```

- [ ] **Step 2: ComparisonTable test**

```tsx
// apps/website/__tests__/components/ComparisonTable.test.tsx
import { cleanup, render } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";

import { ComparisonTable } from "../../app/components/ComparisonTable";

afterEach(() => {
  cleanup();
});

it("renders a comparison table with at least one row", () => {
  const { container } = render(<ComparisonTable />);
  // ComparisonTable is grid-based, not a <table>. Assert it produces structural content.
  expect((container.textContent ?? "").trim().length).toBeGreaterThan(0);
  expect(container.firstChild).toBeInTheDocument();
});
```

- [ ] **Step 3: FeatureGrid test**

```tsx
// apps/website/__tests__/components/FeatureGrid.test.tsx
import { cleanup, render } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";

import { FeatureGrid } from "../../app/components/FeatureGrid";

afterEach(() => {
  cleanup();
});

it("renders a feature grid with multiple feature blocks", () => {
  const { container } = render(<FeatureGrid />);
  // Assert at least two heading-bearing children. The grid renders ≥6 features
  // so two is a conservative floor that won't churn if a feature is renamed.
  const headings = container.querySelectorAll("h3, h4");
  expect(headings.length).toBeGreaterThanOrEqual(2);
});
```

If `FeatureGrid` uses different heading levels (e.g., all `<h2>`), update the selector after reading the component source.

- [ ] **Step 4: CodeExample test**

```tsx
// apps/website/__tests__/components/CodeExample.test.tsx
import { cleanup, render } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";

import { CodeExample } from "../../app/components/CodeExample";

afterEach(() => {
  cleanup();
});

it("renders the code example block with content", () => {
  const { container } = render(<CodeExample />);
  // CodeExample uses shiki to render highlighted code in a <pre>.
  expect(container.querySelector("pre")).toBeInTheDocument();
});
```

If `CodeExample` does its highlighting at module-load time and returns a Promise, this test will fail with a hydration / suspense error. In that case, switch to:

```tsx
const ui = await CodeExample();
const { container } = render(ui);
```

(`CodeExample` is async only when it uses `await` inside an RSC body; otherwise the synchronous form above works. Check the source first.)

- [ ] **Step 5: Run all tests**

Run: `pnpm --filter @pretable/app-website test`
Expected: 10 passing tests.

- [ ] **Step 6: Commit**

```bash
git add apps/website/__tests__/components/ReceiptsBand.test.tsx \
        apps/website/__tests__/components/ComparisonTable.test.tsx \
        apps/website/__tests__/components/FeatureGrid.test.tsx \
        apps/website/__tests__/components/CodeExample.test.tsx
git commit -m "test(website): smoke-test ReceiptsBand, ComparisonTable, FeatureGrid, CodeExample"
```

---

## Task 5: Smoke test for PlaygroundSection

**Files:**

- Create: `apps/website/__tests__/components/PlaygroundSection.test.tsx`

`PlaygroundSection` is a `"use client"` component that mounts the live `@pretable/react` grid. It pulls in scenario data and renders the actual InspectionGrid surface — heavier than the static sections.

- [ ] **Step 1: Write the test**

```tsx
// apps/website/__tests__/components/PlaygroundSection.test.tsx
import { cleanup, render } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";

import { PlaygroundSection } from "../../app/components/PlaygroundSection";

afterEach(() => {
  cleanup();
});

it("renders the playground section with a grid container", () => {
  const { container } = render(<PlaygroundSection />);
  // Section renders the grid surface inside an element with id="grid".
  expect(container.querySelector("#grid")).toBeInTheDocument();
});
```

- [ ] **Step 2: Run the test**

Run: `pnpm --filter @pretable/app-website test -- PlaygroundSection`
Expected: PASS.

If the test fails because `@pretable/react` performs DOM measurements (e.g., `getBoundingClientRect` returning zeros in jsdom) and throws, weaken the assertion to `expect(container.firstChild).toBeInTheDocument()` and add an `it.skip(...)` block noting that deeper assertions need a real browser. Do NOT introduce mocks for `@pretable/react` — the smoke test's job is to catch import / render-blocking breakage.

- [ ] **Step 3: Commit**

```bash
git add apps/website/__tests__/components/PlaygroundSection.test.tsx
git commit -m "test(website): smoke-test PlaygroundSection grid mounts"
```

---

## Task 6: ScrollReveal test (with IntersectionObserver assertion)

**Files:**

- Create: `apps/website/__tests__/components/ScrollReveal.test.tsx`

`ScrollReveal` is the only component that exercises the `IntersectionObserver` shim. Verify the observer is created and `observe()` is invoked on the wrapped child.

- [ ] **Step 1: Write the test**

```tsx
// apps/website/__tests__/components/ScrollReveal.test.tsx
import { cleanup, render } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";

import { ScrollReveal } from "../../app/components/ScrollReveal";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

it("renders its children", () => {
  const { getByText } = render(
    <ScrollReveal>
      <p>visible-marker</p>
    </ScrollReveal>,
  );
  expect(getByText("visible-marker")).toBeInTheDocument();
});

it("registers an IntersectionObserver on the wrapper", () => {
  const observeSpy = vi.fn();
  class SpyObserver {
    observe = observeSpy;
    unobserve = vi.fn();
    disconnect = vi.fn();
    takeRecords = vi.fn(() => []);
    root = null;
    rootMargin = "";
    thresholds = [];
  }
  // Override the global mock just for this test.
  globalThis.IntersectionObserver =
    SpyObserver as unknown as typeof IntersectionObserver;

  render(
    <ScrollReveal>
      <p>child</p>
    </ScrollReveal>,
  );

  expect(observeSpy).toHaveBeenCalledTimes(1);
});
```

- [ ] **Step 2: Run the test**

Run: `pnpm --filter @pretable/app-website test -- ScrollReveal`
Expected: 2 passing tests.

If the second test fails with `observeSpy` called 0 times, `ScrollReveal` is mounting but the `useEffect` that wires the observer hasn't flushed. `@testing-library/react`'s `render()` flushes effects synchronously for client components. If you're sure the effect should have run, the most likely explanation is the override happened too late (after `ScrollReveal` already captured the original mock at module load). In that case, move the override above `render()` (already done in this snippet) and re-run.

- [ ] **Step 3: Commit**

```bash
git add apps/website/__tests__/components/ScrollReveal.test.tsx
git commit -m "test(website): smoke-test ScrollReveal observes its child"
```

---

## Task 7: LandingAmbient test (six blobs)

**Files:**

- Create: `apps/website/__tests__/components/LandingAmbient.test.tsx`

`LandingAmbient` is a server component that renders six absolute-positioned blob divs inside an `aria-hidden` wrapper. The blob count is part of the design contract (Phase 2.B narrative arc).

- [ ] **Step 1: Write the test**

```tsx
// apps/website/__tests__/components/LandingAmbient.test.tsx
import { cleanup, render } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";

import { LandingAmbient } from "../../app/components/LandingAmbient";

afterEach(() => {
  cleanup();
});

it("renders six blob children inside an aria-hidden wrapper", () => {
  const { container } = render(<LandingAmbient />);
  const wrapper = container.querySelector('[aria-hidden="true"]');
  expect(wrapper).toBeInTheDocument();
  // The six blobs are absolutely-positioned children of the wrapper.
  expect(wrapper?.children.length).toBe(6);
});
```

- [ ] **Step 2: Run the test**

Run: `pnpm --filter @pretable/app-website test -- LandingAmbient`
Expected: PASS.

If the count is wrong (e.g., 5 or 7), inspect `LandingAmbient.tsx` and confirm the BLOBS array length. The narrative arc requires exactly six (cool→indigo→cyan→amber→amber→cyan); if the source legitimately ships a different count, that's a Phase 2.B regression and should be investigated, not papered over by changing the test.

- [ ] **Step 3: Commit**

```bash
git add apps/website/__tests__/components/LandingAmbient.test.tsx
git commit -m "test(website): smoke-test LandingAmbient renders six blobs"
```

---

## Task 8: Living visual-system README

**Files:**

- Modify: `apps/website/README.md`

Replace the existing Next.js boilerplate with the living doc. Read the current file first so you know exactly what's being replaced. Follow the section order from spec §3.1.

- [ ] **Step 1: Write the new README**

Replace the entire contents of `apps/website/README.md` with:

````markdown
# @pretable/app-website

The pretable marketing landing page. Single route (`/`), cool-slate AI-startup direction, scroll-driven narrative.

This README is **living documentation** of the visual system as it exists today. It supersedes the proposal at `docs/superpowers/specs/2026-04-21-pretable-visual-system-design.md`.

## Tokens

The website's color and typography tokens live in `@pretable/ui` and are imported via `app/globals.css`:

```css
@import "@pretable/ui/tokens.css";
@import "@pretable/ui/components.css";
```

The Tailwind theme block in `globals.css` exposes them as `--color-*` shortcuts (e.g., `bg-bg-page`, `text-text-primary`, `text-accent`). For the canonical token list and values, read `packages/ui/src/tokens.css`. Don't restate values here — pointer-only.

Token groups in active use on the website:

| Group       | Tokens                                                                                  |
| ----------- | --------------------------------------------------------------------------------------- |
| Backgrounds | `--pt-bg-page`, `--pt-bg-card`, `--pt-bg-raised`                                        |
| Text        | `--pt-text-primary`, `--pt-text-secondary`, `--pt-text-muted`, `--pt-text-dim`          |
| Accent      | `--pt-accent`, `--pt-accent-deep`, `--pt-accent-soft`                                   |
| Rules       | `--pt-rule`, `--pt-rule-soft`                                                           |
| Severity    | `--pt-sev-info`, `--pt-sev-warn`, `--pt-sev-err`, `--pt-sev-ok`                         |
| Grid        | `--pt-grid-bg`, `--pt-grid-raised`, `--pt-grid-rule`, `--pt-grid-text`, `--pt-grid-dim` |

## Type stack

Three variable fonts, all loaded via `@fontsource-variable/*`:

- **Fraunces Variable** — display / serif (hero, section headlines). Token: `--font-display`.
- **Inter Variable** — sans body. Token: `--font-sans`.
- **JetBrains Mono Variable** — code, eyebrow labels, grid cells. Token: `--font-mono`.

## Page gradient + ambient layer

The body element ships a fixed-position vertical gradient (`var(--pt-bg-page)` → indigo midtone → near-black → `--pt-bg-page`) via `app/globals.css`. Two notes:

- `body { position: relative }` is required so `<LandingAmbient />`'s `absolute inset-0` wrapper anchors to the document, not the viewport.
- `background-attachment: fixed` keeps the gradient locked while the page scrolls.

## Section anatomy

`app/page.tsx` renders nine sections in order:

| #   | Component           | Role                                                          |
| --- | ------------------- | ------------------------------------------------------------- |
| 1   | `Hero`              | Headline + subhead. Above the fold. No scroll animation.      |
| 2   | `PlaygroundSection` | Live `@pretable/react` grid. Above-the-fold proof.            |
| 3   | `Problem`           | The wedge: read-heavy grids stall in competitor libs.         |
| 4   | `Solution`          | Pretable renders the wedge at 60fps.                          |
| 5   | `ReceiptsBand`      | Headline metric strip ("receipts, not claims").               |
| 6   | `ComparisonTable`   | Cell-by-cell receipts vs. competitors.                        |
| 7   | `FeatureGrid`       | Six feature cards.                                            |
| 8   | `CodeExample`       | Single-import code snippet (shiki).                           |
| 9   | `CtaSection`        | Final cool crescendo. Links to repo / install / next surface. |

Sections 3–9 are wrapped in `<ScrollReveal>`. Sections 1–2 are not (they're visible on first paint).

## Narrative scaffolding

Two systems span the page:

### `<ScrollReveal>` (client component)

`app/components/ScrollReveal.tsx` — IntersectionObserver one-shot pattern. When a wrapped section first crosses 20% visibility, it animates from `opacity: 0; translateY(24px)` → `opacity: 1; translateY(0)` over 700ms with `ease-out`. After the first reveal, the observer disconnects — sections never re-animate on scroll-back. Respects `prefers-reduced-motion: reduce` (drops the translate, keeps opacity).

### `<LandingAmbient />` (server component)

`app/components/LandingAmbient.tsx` — six absolute-positioned, blurred radial-gradient divs at `-z-40`, behind everything else. Color arc cool → indigo → cyan → amber → amber → cyan, mirroring the page narrative (entry, problem cold beat, solution warmth, proof zone, proof zone, CTA crescendo).

The blob `top` values are tuned to the current rendered section heights. If a section is added, removed, or substantially resized, **re-tune the blob positions** so the colors still land behind their intended sections. The component file has a comment block walking through the workflow; read it before adjusting.

## Adding a new section

1. Create `app/components/Foo.tsx` as a server component (default). Use `"use client"` only if the section needs hooks or browser APIs.
2. Import tokens via Tailwind class names (`text-text-primary`, `bg-bg-card`, etc.) — no inline color hex values.
3. Render in `app/page.tsx`. If the section sits below the fold, wrap it in `<ScrollReveal>`; if above the fold, render bare.
4. Add a smoke test at `__tests__/components/Foo.test.tsx` using the existing pattern (render + one assertion).
5. If the section meaningfully changes page height, re-tune `LandingAmbient`'s blob `top` values.

## Testing

`apps/website/__tests__/` holds smoke tests only — one per top-level component plus the home page. Each test renders the component and asserts something stable (a heading exists, a wrapper renders, the code block is present). No interaction tests, no snapshots, no visual regression. The goal is to catch import-level breakage in CI, not to assert visual correctness.

Run locally: `pnpm --filter @pretable/app-website test`.
````

- [ ] **Step 2: Verify the README renders cleanly**

Run: `pnpm prettier --check apps/website/README.md`
Expected: "All matched files use Prettier code style!"
If prettier complains, run: `pnpm prettier --write apps/website/README.md`.

- [ ] **Step 3: Commit**

```bash
git add apps/website/README.md
git commit -m "docs(website): living visual-system README"
```

---

## Task 9: Mark old visual-system spec superseded

**Files:**

- Modify: `docs/superpowers/specs/2026-04-21-pretable-visual-system-design.md`

- [ ] **Step 1: Read the existing top of the file**

Read the first 10 lines so you know what's there. The current opening is:

```markdown
# Pretable Visual System — Design Spec

**Date:** 2026-04-21
**Status:** Draft for review
```

- [ ] **Step 2: Prepend the supersede banner**

Edit the file to insert the banner directly after the H1, before the existing `**Date:**` line. The new opening becomes:

```markdown
# Pretable Visual System — Design Spec

> **Status: Superseded.** This spec described a cream/amber editorial palette. The website pivoted to a cool-slate AI-startup direction in Phase 2.A (2026-04-30). For the current visual system, see [`apps/website/README.md`](../../../apps/website/README.md). This document is preserved for design-history continuity.

**Date:** 2026-04-21
**Status:** Draft for review
```

Use `Edit` with `old_string` matching the exact existing first non-H1 line (`**Date:** 2026-04-21`) and `new_string` containing the banner + a blank line + the same line back. Do not modify any other content in the file.

- [ ] **Step 3: Verify prettier-clean**

Run: `pnpm prettier --check docs/superpowers/specs/2026-04-21-pretable-visual-system-design.md`
Expected: clean. If not, `pnpm prettier --write` the file.

- [ ] **Step 4: Commit**

```bash
git add docs/superpowers/specs/2026-04-21-pretable-visual-system-design.md
git commit -m "docs: mark 2026-04-21 visual-system spec superseded"
```

---

## Task 10: Local CI dry-run

**Files:** none

- [ ] **Step 1: Run all CI gates locally**

Run each in turn. Fix any failure before proceeding.

```bash
pnpm --filter @pretable/app-website test
pnpm --filter @pretable/app-website typecheck
pnpm --filter @pretable/app-website lint
pnpm --filter @pretable/app-website build
pnpm format
```

Expected: each completes successfully. The total test count should be **12** (page × 2 + ten component tests + ScrollReveal × 2 = page 2 + Hero/Problem/Solution/Cta × 4 + ReceiptsBand/ComparisonTable/FeatureGrid/CodeExample × 4 + PlaygroundSection × 1 + ScrollReveal × 2 + LandingAmbient × 1 = **14 passing tests**).

If `pnpm format` rewrites anything, commit the formatting fix:

```bash
git add -u
git commit -m "style: apply prettier formatting"
```

- [ ] **Step 2: Confirm root-level test run picks up the website**

Run: `pnpm test`
Expected: existing package tests still pass AND the website test job runs (look for `@pretable/app-website test:` in the output).

- [ ] **Step 3: Push branch and open PR**

```bash
git push -u origin feat/website-phase-2c
gh pr create --title "feat(website): phase 2.C — RSC smoke tests + living README" --body "$(cat <<'EOF'
## Summary

- Adds `apps/website/__tests__/` with 12 smoke tests (page + 11 components) under vitest + jsdom.
- Replaces `apps/website/README.md` boilerplate with a living visual-system doc (tokens, type, sections, narrative scaffolding, "how to add a section").
- Marks `docs/superpowers/specs/2026-04-21-pretable-visual-system-design.md` as superseded with a one-line banner pointing at the new README.

## Test plan

- [ ] CI: `test`, `typecheck`, `lint`, `format`, `build` all green.
- [ ] `pnpm --filter @pretable/app-website test` passes locally (14 tests).
- [ ] README renders correctly on GitHub (preview the file).

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

---

## Self-review

**Spec coverage:**

- §3.1 (living README) → Task 8 ✅
- §3.2 (supersede banner) → Task 9 ✅
- §3.3 (12 smoke tests) → Tasks 2, 3, 4, 5, 6, 7 ✅ (page=2, Hero+Problem+Solution+Cta=4, ReceiptsBand+ComparisonTable+FeatureGrid+CodeExample=4, PlaygroundSection=1, ScrollReveal=2, LandingAmbient=1, total=14 — slightly over the spec's "~12" estimate because page and ScrollReveal each have 2 assertions; spec says "~12" so this is fine)
- §3.4 (vitest config) → Task 1 ✅
- §3.5 (package additions: scripts only, deps hoisted) → Task 1 step 3 ✅
- §3.6 (CI auto-pickup) → Task 10 step 2 ✅
- §9 success criteria → all covered across Task 10.

**Placeholder scan:** none. Every step has concrete code or commands. Conditional fallback in Task 4 (`CodeExample` async case) names the actual code change to make, not a vague "handle the async case."

**Type / name consistency:** `IntersectionObserver` mock shape matches across setup.ts (Task 1) and ScrollReveal test override (Task 6). Component import paths match the actual exports observed in `apps/website/app/components/` (default export of `HomePage` from `app/page.tsx`; named exports for the rest, confirmed against `app/page.tsx` line 1–10).
