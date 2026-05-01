# Website Phase 2.B Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add two polish layers on top of Phase 2.A's static landing — a `<ScrollReveal />` client component that fades + slides each body section in on first scroll-into-view, and a `<LandingAmbient />` server component that renders six absolute-positioned blurred radial-gradient blobs implementing the cool→cold→cyan→amber→amber→cyan ambient narrative.

**Architecture:** Two new components in `apps/website/app/components/` (one client, one server). Two file modifications: `layout.tsx` adds `<LandingAmbient />` once; `page.tsx` wraps the seven body sections in `<ScrollReveal>`. No new dependencies — `IntersectionObserver` is native, blobs are CSS. `prefers-reduced-motion: reduce` users see all content at full opacity from first paint via Tailwind's `motion-reduce:` variants.

**Tech Stack:** Next.js 16 (App Router, RSC), React 19, Tailwind v4 (`@tailwindcss/postcss`). No new packages.

---

## File Structure

**Created (2 component files):**

```
apps/website/app/components/
  LandingAmbient.tsx        // server, ~70 lines, 6 abs-positioned blobs at scroll milestones
  ScrollReveal.tsx          // client, ~40 lines, IntersectionObserver one-shot wrapper
```

**Modified:**

```
apps/website/app/layout.tsx       // insert <LandingAmbient /> as first child of <body>
apps/website/app/page.tsx         // wrap 7 body sections in <ScrollReveal>; add ScrollReveal import
```

**No new tests** in Phase 2.B. RSC test setup lands in Phase 2.C.

**No package.json changes.** No new deps.

---

## Task 1: Create `<ScrollReveal />` (client component)

A small `"use client"` component that wraps children, observes its own root element with `IntersectionObserver`, and toggles fade+slide-up classes on first intersection. One-shot (disconnects after firing). Honors `prefers-reduced-motion: reduce` via Tailwind variants — reduced-motion users see content at full opacity from first paint.

**Files:**

- Create: `apps/website/app/components/ScrollReveal.tsx`

- [ ] **Step 1: Create the file**

```tsx
"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";

/**
 * Wraps children and fades them in (opacity 0 → 1) + slides up
 * (translateY 24px → 0) when the wrapper's root element first becomes
 * 20% visible in the viewport. One-shot — observer disconnects after
 * the first intersection, so re-scrolling doesn't re-trigger.
 *
 * Reduced motion: under `prefers-reduced-motion: reduce`, the transition
 * is suppressed (`motion-reduce:transition-none`) and the hidden state's
 * opacity/translate are forced to the visible values
 * (`motion-reduce:opacity-100 motion-reduce:translate-y-0`), so the user
 * sees content at full opacity from first paint regardless of observer
 * status.
 *
 * SSR: initial state is `visible: false` on server + first-paint client.
 * The IntersectionObserver runs in `useEffect` (client-only). Sections
 * already in the viewport on first paint fire on mount and animate in
 * normally.
 */
export function ScrollReveal({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            setVisible(true);
            observer.disconnect();
            break;
          }
        }
      },
      { threshold: 0.2 },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  return (
    <div
      ref={ref}
      className={[
        "transition-all duration-700 ease-out motion-reduce:transition-none",
        visible
          ? "opacity-100 translate-y-0"
          : "opacity-0 translate-y-6 motion-reduce:opacity-100 motion-reduce:translate-y-0",
      ].join(" ")}
    >
      {children}
    </div>
  );
}
```

- [ ] **Step 2: Verify it builds**

```bash
pnpm --filter @pretable/app-website typecheck
```

Expected: PASS. The file isn't imported by anything yet, but typecheck verifies the syntax + types compile.

If you see a typecheck error about `IntersectionObserver`, the `lib: ["dom", "dom.iterable", "esnext"]` already in `apps/website/tsconfig.json` should provide the types. If not, that's a real config issue worth reporting.

- [ ] **Step 3: Commit**

```bash
git add apps/website/app/components/ScrollReveal.tsx
git commit -m "feat(website): add ScrollReveal client component (one-shot fade+slide on scroll)"
```

---

## Task 2: Create `<LandingAmbient />` (server component)

Six absolute-positioned, heavily-blurred radial-gradient `<div>`s wrapped in a `-z-40` container. Pattern matches dawn's `LandingAmbient`. `aria-hidden` + `pointer-events: none` keep them out of interaction + a11y trees. The wrapper spans the full body via `absolute inset-0` so blobs can be positioned anywhere on the page.

The `top:` values are first-pass estimates from §3 of the spec's scroll-height table. They will be re-tuned during manual smoke (Task 5) once we observe actual rendered section heights.

**Files:**

- Create: `apps/website/app/components/LandingAmbient.tsx`

- [ ] **Step 1: Create the file**

```tsx
import type { CSSProperties } from "react";

interface Blob {
  readonly top: string;
  readonly side: "left" | "right" | "center";
  readonly offset: string;
  readonly size: number;
  readonly color: string;
}

// Six-blob narrative arc: cool → cold → cyan → amber → amber → cyan.
// Each blob anchors a specific section's emotional beat. The cool→warm→cool
// shape mirrors the page-gradient base from Phase 2.A.
//
// Tuning: scroll `top:` values are first-pass estimates derived from the
// section-height table in docs/superpowers/specs/2026-05-01-website-phase-2b-design.md §3.
// To re-tune after a section's height changes:
//   1. Boot dev: `pnpm --filter @pretable/app-website dev`
//   2. In DevTools console, run for each section:
//        document.querySelector('section h2')
//          ?.closest('section')
//          ?.getBoundingClientRect();
//      Record the top + height.
//   3. Recompute cumulative tops (Hero start + Hero height + Playground height + ...).
//   4. Adjust the `top:` values below to bleed into their target sections.
const BLOBS: readonly Blob[] = [
  // ① cyan / hero / cool entry
  {
    top: "40px",
    side: "left",
    offset: "-120px",
    size: 320,
    color: "rgba(56, 189, 248, 0.14)",
  },
  // ② indigo / problem / cold beat (only indigo on the page)
  {
    top: "1300px",
    side: "right",
    offset: "-100px",
    size: 360,
    color: "rgba(99, 102, 241, 0.12)",
  },
  // ③ cyan / solution / cyan answer
  {
    top: "1900px",
    side: "left",
    offset: "-80px",
    size: 300,
    color: "rgba(56, 189, 248, 0.16)",
  },
  // ④ amber / receipts + comparison / proof opens
  {
    top: "2400px",
    side: "center",
    offset: "-200px",
    size: 400,
    color: "rgba(245, 158, 11, 0.10)",
  },
  // ⑤ amber / features + code / proof continues
  {
    top: "3300px",
    side: "right",
    offset: "-80px",
    size: 360,
    color: "rgba(245, 158, 11, 0.08)",
  },
  // ⑥ cyan / cta / cool crescendo (peak alpha)
  {
    top: "4200px",
    side: "center",
    offset: "-180px",
    size: 360,
    color: "rgba(56, 189, 248, 0.18)",
  },
];

function blobStyle(blob: Blob): CSSProperties {
  const positionStyle: CSSProperties = { top: blob.top };
  if (blob.side === "left") positionStyle.left = blob.offset;
  if (blob.side === "right") positionStyle.right = blob.offset;
  if (blob.side === "center") {
    positionStyle.left = "50%";
    positionStyle.transform = `translateX(calc(-50% + ${blob.offset}))`;
  }
  return {
    ...positionStyle,
    width: blob.size,
    height: blob.size,
    background: `radial-gradient(circle at center, ${blob.color}, transparent 70%)`,
    filter: "blur(40px)",
  };
}

/**
 * Page-level ambient layer: six absolute-positioned, heavily-blurred
 * radial-gradient blobs at scroll-height milestones. Sits at -z-40 behind
 * everything else; sections render on top. aria-hidden + pointer-events:
 * none keep this out of a11y and interaction trees.
 *
 * Layout: parent div spans the full body (`absolute inset-0`); each blob
 * positions itself within using its own `top:` and side anchoring.
 */
export function LandingAmbient() {
  return (
    <div
      aria-hidden
      className="pointer-events-none absolute inset-0 -z-40 overflow-hidden"
    >
      {BLOBS.map((blob, idx) => (
        <div
          key={idx}
          className="absolute rounded-full"
          style={blobStyle(blob)}
        />
      ))}
    </div>
  );
}
```

- [ ] **Step 2: Verify it builds**

```bash
pnpm --filter @pretable/app-website typecheck
```

Expected: PASS. No imports yet, but type-level validation runs.

- [ ] **Step 3: Commit**

```bash
git add apps/website/app/components/LandingAmbient.tsx
git commit -m "feat(website): add LandingAmbient server component (6 blobs, cool→warm→cool arc)"
```

---

## Task 3: Wire `<LandingAmbient />` into `layout.tsx`

Add it as the first child of `<body>`. Z-stacking: page gradient on `<body>` (back) → `<LandingAmbient />` blobs at `-z-40` (mid-back) → Nav / main / Footer at default z-index (front).

**Files:**

- Modify: `apps/website/app/layout.tsx`

- [ ] **Step 1: Update `layout.tsx`**

Open `apps/website/app/layout.tsx`. The current file should look like:

```tsx
import { Footer, Nav } from "@pretable/ui";
import type { Metadata, Viewport } from "next";

import "./globals.css";

const APP_VERSION = process.env.npm_package_version ?? "0.0.0";

export const metadata: Metadata = {
  title: "pretable",
  description: "The grid that treats scroll as a first-class feature.",
};

export const viewport: Viewport = {
  themeColor: "#0b1120",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>
        <Nav active="website" version={APP_VERSION} />
        <main>{children}</main>
        {/* TODO(ci-signal): wire ciStatus to a real source once CI status plumbing exists.
            Hardcoded "green" for now — parity with apps/playground/src/app.tsx. */}
        <Footer version={APP_VERSION} ciStatus="green" />
      </body>
    </html>
  );
}
```

Add the `LandingAmbient` import (alphabetized with `Footer, Nav`) and render `<LandingAmbient />` as the first child of `<body>`:

```tsx
import { Footer, Nav } from "@pretable/ui";
import type { Metadata, Viewport } from "next";

import { LandingAmbient } from "./components/LandingAmbient";
import "./globals.css";

const APP_VERSION = process.env.npm_package_version ?? "0.0.0";

export const metadata: Metadata = {
  title: "pretable",
  description: "The grid that treats scroll as a first-class feature.",
};

export const viewport: Viewport = {
  themeColor: "#0b1120",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>
        <LandingAmbient />
        <Nav active="website" version={APP_VERSION} />
        <main>{children}</main>
        {/* TODO(ci-signal): wire ciStatus to a real source once CI status plumbing exists.
            Hardcoded "green" for now — parity with apps/playground/src/app.tsx. */}
        <Footer version={APP_VERSION} ciStatus="green" />
      </body>
    </html>
  );
}
```

The blob layer is `absolute inset-0` — not in the document flow, doesn't affect Nav/main/Footer positioning. DOM order doesn't matter for visual stacking; the `-z-40` class is what positions it behind.

- [ ] **Step 2: Verify it builds**

```bash
pnpm --filter @pretable/app-website build
```

Expected: PASS. `/` prerenders. The blobs render in the static HTML output.

- [ ] **Step 3: Commit**

```bash
git add apps/website/app/layout.tsx
git commit -m "feat(website): mount LandingAmbient in root layout"
```

---

## Task 4: Wrap body sections in `<ScrollReveal>` in `page.tsx`

Update `apps/website/app/page.tsx` to import `ScrollReveal` and wrap the seven body sections (Problem onward) individually. Hero and PlaygroundSection stay un-wrapped — they're above the fold.

**Files:**

- Modify: `apps/website/app/page.tsx`

- [ ] **Step 1: Update `page.tsx`**

Replace `apps/website/app/page.tsx` entirely with:

```tsx
import { CodeExample } from "./components/CodeExample";
import { ComparisonTable } from "./components/ComparisonTable";
import { CtaSection } from "./components/CtaSection";
import { FeatureGrid } from "./components/FeatureGrid";
import { Hero } from "./components/Hero";
import { PlaygroundSection } from "./components/PlaygroundSection";
import { Problem } from "./components/Problem";
import { ReceiptsBand } from "./components/ReceiptsBand";
import { ScrollReveal } from "./components/ScrollReveal";
import { Solution } from "./components/Solution";

export default function HomePage() {
  return (
    <>
      <Hero />
      <PlaygroundSection />
      <ScrollReveal>
        <Problem />
      </ScrollReveal>
      <ScrollReveal>
        <Solution />
      </ScrollReveal>
      <ScrollReveal>
        <ReceiptsBand />
      </ScrollReveal>
      <ScrollReveal>
        <ComparisonTable />
      </ScrollReveal>
      <ScrollReveal>
        <FeatureGrid />
      </ScrollReveal>
      <ScrollReveal>
        <CodeExample />
      </ScrollReveal>
      <ScrollReveal>
        <CtaSection />
      </ScrollReveal>
    </>
  );
}
```

Imports stay alphabetized — `ScrollReveal` slots between `PlaygroundSection` and `Solution`. The seven body sections each get one wrapper. Hero + PlaygroundSection are un-wrapped.

- [ ] **Step 2: Verify it builds**

```bash
pnpm --filter @pretable/app-website build
```

Expected: PASS. `/` prerenders. The page now ships with the fade+slide-up classes baked into the seven body section wrappers (initially `opacity-0 translate-y-6`, with `motion-reduce:opacity-100 motion-reduce:translate-y-0` overrides). On client hydration, the IntersectionObservers boot and progressively flip them to `opacity-100 translate-y-0`.

- [ ] **Step 3: Commit**

```bash
git add apps/website/app/page.tsx
git commit -m "feat(website): wrap body sections in ScrollReveal for scroll-in animations"
```

---

## Task 5: Repo-wide CI dry-run + manual smoke + scroll-height tuning

Verify the full repo + manual visual smoke. Includes the scroll-height tuning step for the LandingAmbient blob `top:` values.

**Files:** potentially `apps/website/app/components/LandingAmbient.tsx` (only if scroll-height tuning shifts values).

- [ ] **Step 1: Repo-wide CI dry-run**

```bash
pnpm install --frozen-lockfile
pnpm test
pnpm typecheck
pnpm lint
pnpm format
pnpm build
```

Expected: all green.

- `pnpm install` — lockfile unchanged (no deps added).
- `pnpm test` — green (no test changes).
- `pnpm typecheck` — clean across 16 workspaces.
- `pnpm lint` — clean (the two pre-existing layout.tsx warnings persist; not new).
- `pnpm format` — clean. If any of the new files surface, run `pnpm format:write`.
- `pnpm build` — website builds; `/` prerenders.

If `pnpm format` flags the new files, fix:

```bash
pnpm format:write
git add apps/website/app/components/ScrollReveal.tsx apps/website/app/components/LandingAmbient.tsx apps/website/app/layout.tsx apps/website/app/page.tsx
git commit -m "style: apply prettier formatting"
```

- [ ] **Step 2: Boot dev for manual smoke + scroll-height tuning**

```bash
pnpm --filter @pretable/app-website dev
```

Open the dev URL (`http://localhost:3000` or a fallback like 3001 if 3000 is taken). Walk through:

**Animation behavior:**

- Hero + PlaygroundSection visible at full opacity on first paint. No animation.
- Scroll down past the live grid. As Problem enters the viewport, it fades + slides up over ~700ms.
- Continue scrolling. Solution → ReceiptsBand → ComparisonTable → FeatureGrid → CodeExample → CtaSection each animate in once.
- Scroll back up: sections do NOT re-animate (one-shot disconnect verified).
- Scroll back down: still no re-animation.

**Reduced motion:**

- DevTools → Rendering pane → "Emulate CSS media feature `prefers-reduced-motion`" → set to `reduce`.
- Reload the page.
- All seven body sections render at full opacity from first paint. No fade, no slide. Reload + scroll: still no animation.
- Disable the emulation; the animations come back.

**Blob narrative:**

- Page gradient is subtly visible (Phase 2.A baseline).
- Six blobs visible behind sections — each at low alpha but discernible at viewport scale:
  - cyan glow behind Hero (top-left)
  - indigo wash behind Problem (right)
  - cyan glow behind Solution (left)
  - amber wash through Receipts → Comparison (center, peak around the middle of the page)
  - amber wash continuing through Features → Code (right)
  - cyan crescendo behind CTA (center, brightest of the six)
- Footer has no blob behind.

- [ ] **Step 3: Tune blob `top:` values if needed**

Open DevTools console while on the dev URL. Run this snippet to log the y-position of each section's center:

```javascript
[...document.querySelectorAll("section")].forEach((s, i) => {
  const r = s.getBoundingClientRect();
  const top = r.top + window.scrollY;
  const center = top + r.height / 2;
  const label =
    s.querySelector("h1, h2")?.textContent?.slice(0, 40) ?? "(no heading)";
  console.log(
    `#${i} top=${Math.round(top)} center=${Math.round(center)} :: ${label}`,
  );
});
```

Expected output (approximately):

```
#0 top=0 center=~360 :: The grid that treats scroll as a first-class
#1 top=~720 center=~1010 :: (PlaygroundSection — chrome strip, no h2)
#2 top=~1300 center=~1500 :: Other grids stall on the read-heavy wedge
#3 top=~1700 center=~1925 :: Pretable renders the wedge at 60fps
#4 top=~2150 center=~2325 :: Receipts, not claims.
#5 top=~2500 center=~2725 :: Cell-by-cell receipts.
#6 top=~2950 center=~3225 :: Six receipts.
#7 top=~3500 center=~3750 :: One import. Stream tokens into a stable grid
#8 top=~4000 center=~4200 :: Check the receipts.
```

Compare each blob's `top:` in `LandingAmbient.tsx` against where you want it to anchor:

- ① `top: "40px"` should sit inside Hero (top=0..720). 40px puts it near the top of Hero. Probably fine; adjust to ~150-250 to anchor mid-Hero if it reads off.
- ② `top: "1300px"` should sit inside Problem (~1300..1700). 1300 is the very top of Problem — if it reads as anchored above Problem, push to ~1450-1500.
- ③ `top: "1900px"` should sit inside Solution (~1700..2150). 1900 is mid-Solution. Probably fine.
- ④ `top: "2400px"` should bleed Receipts → Comparison (~2150..2950). 2400 is between them. Probably fine.
- ⑤ `top: "3300px"` should bleed Features → Code (~2950..4000). 3300 is mid-Features. Probably fine.
- ⑥ `top: "4200px"` should sit inside CTA (~4000..4400). 4200 is mid-CTA. Probably fine.

Edit `LandingAmbient.tsx` if any blob's anchoring reads off (more than ~150px from where you want it). Re-run dev, re-eyeball.

If you adjust any value, commit:

```bash
git add apps/website/app/components/LandingAmbient.tsx
git commit -m "fix(website): retune LandingAmbient blob top values to actual section heights"
```

If no adjustments, skip the commit.

- [ ] **Step 4: Optional production smoke**

If you want to verify against a production build:

```bash
pnpm --filter @pretable/app-website build
pnpm --filter @pretable/app-website start
```

Open the URL. Same checklist. Production build is what Vercel ships when deployed.

Ctrl-C out when done.

---

## Task 6: Push + open PR

**Files:** none modified — git operations.

- [ ] **Step 1: Push the branch**

```bash
git push -u origin feat/website-phase-2b
```

- [ ] **Step 2: Open the PR**

```bash
gh pr create --title "feat(website): phase 2.B — ScrollReveal + ambient blobs" --body "$(cat <<'EOF'
## Summary

Phase 2.B of the website pivot. Adds two polish layers to Phase 2.A's static landing:

- **`<ScrollReveal />`** (client component, ~40 lines) — wraps each body section with `IntersectionObserver`. On first 20% intersection, fades from `opacity-0` to `opacity-100` and slides from `translate-y-6` to `translate-y-0` over 700ms `ease-out`. One-shot — disconnects after first intersection, never re-animates on re-scroll.

- **`<LandingAmbient />`** (server component, ~70 lines) — six absolute-positioned blurred radial-gradient blobs at scroll-height milestones implementing the cool → cold-indigo → cyan → amber → amber → cyan narrative. Sits at `-z-40` behind everything; bleeds through transparent section backgrounds.

### What ships

- New: `apps/website/app/components/ScrollReveal.tsx`
- New: `apps/website/app/components/LandingAmbient.tsx`
- Modified: `apps/website/app/layout.tsx` — mounts `<LandingAmbient />` once.
- Modified: `apps/website/app/page.tsx` — wraps the 7 body sections (Problem → CtaSection) in `<ScrollReveal>`. Hero + PlaygroundSection stay un-wrapped (above-the-fold).

### Architecture notes

- **No new dependencies.** `IntersectionObserver` is native; blobs are CSS.
- **Reduced motion respected.** `motion-reduce:transition-none` + `motion-reduce:opacity-100 motion-reduce:translate-y-0` ensure `prefers-reduced-motion: reduce` users see all sections at full opacity from first paint with no animation.
- **A11y safe.** `aria-hidden` + `pointer-events: none` on the ambient layer; opacity-only hidden state in ScrollReveal preserves screen-reader and tab-key access.
- **Performance.** Six GPU-accelerated blurred divs cost negligible scroll perf. ScrollReveal's IntersectionObservers are one-shot and disconnect after firing.

### Blob narrative (cool → warm → cool)

| # | Color | Position | Section |
|---|-------|----------|---------|
| ① | cyan #38bdf8 (α 0.14) | top-left | Hero (cool entry) |
| ② | indigo #6366f1 (α 0.12) | right | Problem (cold beat — only indigo on the page) |
| ③ | cyan #38bdf8 (α 0.16) | left | Solution (cyan answer) |
| ④ | amber #f59e0b (α 0.10) | center | Receipts + Comparison (proof opens) |
| ⑤ | amber #f59e0b (α 0.08) | right | Features + Code (proof continues) |
| ⑥ | cyan #38bdf8 (α 0.18) | center | CTA (cool crescendo, peak alpha) |

Scroll-height `top:` values are first-pass; tuned during manual smoke against actual rendered section heights. Provenance comment in `LandingAmbient.tsx` documents the re-tune workflow.

### Out of scope

- FeatureGrid card stagger (cards animating in sequence) — Phase 2.B follow-up.
- Hero parallax (dawn-style earth + starfield) — possible Phase 2.D.
- MDX content support — Phase 2.C.
- Updating `docs/superpowers/specs/2026-04-21-pretable-visual-system-design.md` — Phase 2.C.
- Real-time bench data feeds — Phase 2.C / D.
- New tests — Phase 2.C (when Next.js + RSC test setup lands).
- Retiring `apps/playground` — Phase 3.

## Test plan

- [x] `pnpm install --frozen-lockfile` — no deps added; lockfile unchanged
- [x] `pnpm test` — green (no test changes)
- [x] `pnpm typecheck` — clean across 16 workspaces
- [x] `pnpm lint` — clean (2 pre-existing layout.tsx warnings persist)
- [x] `pnpm format` — clean
- [x] `pnpm build` — website builds; `/` prerenders
- [ ] Manual: `pnpm --filter @pretable/app-website dev` — body sections animate in on scroll; one-shot (no re-animation on scroll-back); blob narrative subtly visible behind sections
- [ ] Manual: DevTools `prefers-reduced-motion: reduce` emulation → all sections at full opacity from first paint, no animation
- [ ] Manual: scroll-height tuning verified against actual rendered section heights via the DevTools snippet in the plan

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

Return the PR URL.

- [ ] **Step 3: Report status**

Mark Phase 2.B implementation done. Wait for user merge before starting Phase 2.C.

---

## Spec coverage check

| Spec section                                 | Task(s)                                         |
| -------------------------------------------- | ----------------------------------------------- |
| §1 Goal — ScrollReveal + LandingAmbient      | 1, 2, 3, 4                                      |
| §2 Scope — what 2.B owns                     | structural                                      |
| §3 Architecture — `<ScrollReveal />` shape   | 1                                               |
| §3 Architecture — `<LandingAmbient />` shape | 2                                               |
| §3 Layout integration                        | 3                                               |
| §3 Page composition                          | 4                                               |
| §3 Scroll-height tuning                      | 5 (Step 3)                                      |
| §4 Reduced-motion handling                   | 1 (Tailwind variants) + 5 (manual verification) |
| §5 Performance                               | (no task — implicit in component design)        |
| §6 Testing approach                          | 5 (manual smoke + CI)                           |
| §7 Out of scope                              | (intentionally not a task)                      |
| §8 Rollback                                  | 6 (single squash-merge)                         |
| §9 Risks                                     | inline notes in Tasks 1, 2, 5                   |
| §10 Success criteria                         | 5 (manual smoke checklist)                      |

All spec requirements covered.

---

**End of plan.** Execution via `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans`.
