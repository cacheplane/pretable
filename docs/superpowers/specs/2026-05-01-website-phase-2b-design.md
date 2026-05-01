# Website Phase 2.B — ScrollReveal + Ambient Blobs Design Spec

**Date:** 2026-05-01
**Status:** Draft for review
**Scope:** Phase 2.B of the website pivot — add two polish layers on top of Phase 2.A's static body sections: (1) entrance animations triggered when sections scroll into view, (2) six absolute-positioned blurred color blobs implementing the cool→warm→cool ambient narrative behind transparent section backgrounds.
**Parent context:**

- [`2026-04-30-website-phase-2a-design.md`](./2026-04-30-website-phase-2a-design.md) — Phase 2.A (seven static body sections + page gradient base).
- [`2026-04-24-website-phase-1-design.md`](./2026-04-24-website-phase-1-design.md) — Phase 1 (scaffold + Hero + PlaygroundSection + cool-slate tokens).
- Reference: `~/repos/dawn/apps/web/app/components/landing/LandingAmbient.tsx` (the 6-blob component dawn uses) and `~/repos/dawn/apps/web/app/components/ScrollReveal.tsx` (dawn's section-reveal wrapper).
  **Dependencies shipped:** Phase 2.A PR #20 (`b97ec8a`) — body sections + page gradient on origin/main.

---

## 1. Goal

Phase 2.A landed seven static body sections + a page gradient. The page reads as a complete AI-startup landing in word count and section count, but it lands visually flat: every section appears at full opacity from first paint, and the page gradient by itself is too subtle to carry an emotional arc. Readers don't feel the cool→warm→cool narrative the gradient and copy were designed around.

Phase 2.B adds two polish layers that dawn / aaf / Linear / Vercel landings all share:

1. **`<ScrollReveal />`** — a thin client component that wraps each body section. On first intersection (when ~20% of the section enters the viewport), the wrapped subtree fades in (opacity 0 → 1) AND slides up (translateY 24px → 0) over 700ms with `ease-out` timing. One-shot — never re-animates on re-scroll. Sections render as visible from server (SSR-safe); the animation is an enhancement layered on top via CSS classes that toggle on observed intersection.

2. **`<LandingAmbient />`** — a server component that renders six absolute-positioned, heavily-blurred radial-gradient `<div>`s at scroll-height milestones, implementing the **cool → cold-indigo → cyan → amber → amber → cyan** narrative. Sits behind everything at `-z-40`. `aria-hidden` + `pointer-events: none`. Mirrors dawn's `LandingAmbient` shape.

Together they give the page the depth and pacing the references have. Hero and PlaygroundSection stay un-animated (above-the-fold, visible on first paint).

## 2. Scope boundary

**Phase 2.B owns:**

- New component: `apps/website/app/components/ScrollReveal.tsx` (`"use client"`, ~40 lines, hand-rolled `IntersectionObserver`).
- New component: `apps/website/app/components/LandingAmbient.tsx` (server, ~80 lines, six abs-positioned divs).
- Modification: `apps/website/app/layout.tsx` — render `<LandingAmbient />` once inside `<body>` (above `<Nav>` for z-stacking simplicity, but the blobs sit at `-z-40`, so visual order doesn't depend on DOM order).
- Modification: `apps/website/app/page.tsx` — wrap the seven body sections (Problem through CtaSection) in `<ScrollReveal>`. Hero and PlaygroundSection stay un-wrapped.
- Reduced-motion handling: under `prefers-reduced-motion: reduce`, `<ScrollReveal>` skips the slide+fade and renders content immediately at full opacity (or applies an opacity-only transition — picked at implementation time based on what reads cleanest).
- One PR.

**Phase 2.B does NOT own:**

- Stagger animations inside `<FeatureGrid>` (cards animating in sequence) — defer.
- Hero ScrollReveal (above-the-fold).
- PlaygroundSection ScrollReveal (above-the-fold).
- Blob position retuning based on real rendered section heights — first-pass `top:` estimates ship; tune in follow-up if the visual feels off.
- Page-gradient hex tweaks. Phase 2.A's gradient stays.
- New tests. Next.js + RSC test setup is Phase 2.C.
- Animations on the existing live grid (`PlaygroundSection`'s `InspectionGrid` internals) — that's library territory.
- MDX content support — Phase 2.C.
- Updating `docs/superpowers/specs/2026-04-21-pretable-visual-system-design.md` — Phase 2.C.
- Retiring `apps/playground` — Phase 3.

## 3. Architecture

### Component tree changes

```
apps/website/app/
  layout.tsx                 // MODIFIED: insert <LandingAmbient /> as first child of <body>
  page.tsx                   // MODIFIED: wrap body sections in <ScrollReveal>
  components/
    LandingAmbient.tsx       // NEW: server, 6 blobs at scroll milestones
    ScrollReveal.tsx         // NEW: client, IntersectionObserver wrapper
```

`<LandingAmbient />` renders once at the top of `<body>`. Z-stacking: page gradient on `<body>` (back) → blobs at `-z-40` (mid-back) → sections at default z-index (front). The blobs bleed through transparent section backgrounds. Phase 2.A's gradient is already in place; nothing to coordinate.

### `<ScrollReveal />` shape

Client component. Props: `children: React.ReactNode`. State: `visible: boolean`. Effect: register `IntersectionObserver` on the root ref with `threshold: 0.2`, set `visible = true` on first intersection, disconnect observer (one-shot). Render: a single `<div>` with classes that toggle between two states.

```tsx
"use client";
import { useEffect, useRef, useState, type ReactNode } from "react";

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

Key details:

- `motion-reduce:` Tailwind variant collapses the animation under `prefers-reduced-motion: reduce`. The `motion-reduce:transition-none` on the always-applied class disables the transition; the `motion-reduce:opacity-100 motion-reduce:translate-y-0` on the hidden state forces visible-from-start under reduced motion (so a reduced-motion user never sees a hidden section).
- `threshold: 0.2` — 20% visible triggers. Standard dawn-equivalent.
- One-shot — `observer.disconnect()` after first intersection. Sections that scroll back out and back in don't re-animate.
- SSR-safe — initial state is `visible: false` on both server and first-paint client. The IntersectionObserver runs in `useEffect` (client-only). For sections already in the viewport on first paint (rare for a body section that's below Hero + PlaygroundSection), the observer fires on mount and they animate in normally; for users with `prefers-reduced-motion`, `motion-reduce:opacity-100` overrides the hidden state at CSS level.
- No props beyond `children`. If a future consumer needs a delay or different threshold, that's a YAGNI we can add when there's a real second use case.

### `<LandingAmbient />` shape

Server component. No props. Renders a single positioned-absolute div (the wrapper) containing six positioned-absolute blob divs.

```tsx
interface Blob {
  readonly top: string;
  readonly side: "left" | "right" | "center";
  readonly offset: string;
  readonly size: number;
  readonly color: string;
}

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

function blobStyle(blob: Blob): React.CSSProperties {
  const positionStyle: React.CSSProperties = { top: blob.top };
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

Pattern is byte-similar to dawn's `LandingAmbient`. The wrapper div spans the full body (`absolute inset-0`); each blob is `absolute` within. `-z-40` keeps it behind everything else.

### Scroll-height tuning

The `top:` values above are first-pass estimates derived from rough section-height arithmetic:

| Stop              | Section      | Approx. height | Cumulative top |
| ----------------- | ------------ | -------------- | -------------- |
| Hero              | 0 → ~720     | 720            | 0              |
| PlaygroundSection | 720 → ~1300  | 580            | 720            |
| Problem           | 1300 → ~1700 | 400            | 1300           |
| Solution          | 1700 → ~2150 | 450            | 1700           |
| ReceiptsBand      | 2150 → ~2500 | 350            | 2150           |
| ComparisonTable   | 2500 → ~2950 | 450            | 2500           |
| FeatureGrid       | 2950 → ~3500 | 550            | 2950           |
| CodeExample       | 3500 → ~4000 | 500            | 3500           |
| CtaSection        | 4000 → ~4400 | 400            | 4000           |
| Footer            | 4400 → ~4500 | 100            | 4400           |

Blob `top:` values are positioned to bleed into their target sections (e.g., blob ② at `1300px` sits behind Problem; blob ④ at `2400px` straddles ReceiptsBand → ComparisonTable for the "amber wash through proof" effect).

These are first-pass. **Final tuning happens during implementation:** boot dev, scroll the page, measure actual y-positions of each section's center via DevTools or a one-off `console.log(section.getBoundingClientRect().top + window.scrollY)`, adjust the `top:` values until each blob anchors visually where intended. Document the measurement methodology in a code comment so the next person can re-tune when sections are added.

### Layout integration

`apps/website/app/layout.tsx` adds `<LandingAmbient />` as the first child of `<body>`:

```tsx
<body>
  <LandingAmbient />
  <Nav active="website" version={APP_VERSION} />
  <main>{children}</main>
  <Footer version={APP_VERSION} ciStatus="green" />
</body>
```

The blob layer is `absolute inset-0` — it's NOT in the document flow. It overlays the entire body. Position-static siblings (Nav, main, Footer) render normally on top.

### Page composition (`page.tsx`)

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

Hero + PlaygroundSection stay unwrapped. The wrapping pattern is `<ScrollReveal><Foo /></ScrollReveal>` — minimal markup, no animation prop drilling. Each `<ScrollReveal>` instance owns its own observer + state.

### State ownership

- `<ScrollReveal>` — local `useState<boolean>` for visibility, local `useRef` for the observed element. Each instance is independent. No global state.
- `<LandingAmbient>` — none. Pure render.
- No new context, no new hooks beyond `useEffect` + `useRef` + `useState` already in the React ecosystem.

### Type contracts

- `<ScrollReveal>`: props `{ children: ReactNode }`. No exported types beyond the component itself.
- `<LandingAmbient>`: no props. Internal `Blob` interface stays module-private.

No changes to `@pretable/ui` or `@pretable/react`.

## 4. Reduced-motion handling

`prefers-reduced-motion: reduce` is honored throughout:

- `<ScrollReveal>` uses Tailwind's `motion-reduce:` variant: `motion-reduce:transition-none` (no transition timing) + `motion-reduce:opacity-100 motion-reduce:translate-y-0` (force visible state regardless of observer status). A reduced-motion user sees sections at full opacity from first paint, with no slide-up.
- `<LandingAmbient>` blobs are static — no animation involved — so reduced motion has nothing to suppress. They render the same.

This honors WCAG 2.1 SC 2.3.3 (Animation from Interactions). Manually verifiable in DevTools (Rendering pane → Emulate CSS media feature `prefers-reduced-motion: reduce`).

## 5. Performance

Six absolute-positioned divs with `filter: blur(40px)` and `pointer-events: none` are GPU-accelerated; modern browsers composite them on a separate layer. Scroll cost is negligible at this count. Tested via dawn's identical implementation.

`<ScrollReveal>` registers one `IntersectionObserver` per wrapper instance (7 total at this scale). Each observer is one-shot — disconnects after first intersection. No active observers after the user scrolls past the page once.

No measurable client-bundle impact: `<ScrollReveal>` is ~40 lines of TypeScript that gzip to under 1 KB. `<LandingAmbient>` is server-rendered HTML with no client JS at all.

## 6. Testing

### Phase 2.B explicitly does NOT add tests

- Next.js + RSC unit-test setup is Phase 2.C territory.
- Visual / animation tests would require either Playwright (heavyweight) or Storybook + Chromatic (overkill for two components).
- The two new components are small enough that a manual smoke check + production build success is sufficient for 2.B.

### Repo-wide CI checks must pass

- `pnpm install --frozen-lockfile` — no new deps; lockfile unchanged.
- `pnpm test` — no test changes; existing suites green.
- `pnpm typecheck` — clean across 16 workspaces.
- `pnpm lint` — clean.
- `pnpm format` — clean.
- `pnpm build` — website builds; `/` prerenders.

### Manual smoke before merge

- `pnpm --filter @pretable/app-website dev` boots; landing renders end-to-end.
- Body sections (Problem onward) start hidden (opacity 0, translateY 24px) and animate in as you scroll past them. One-shot — scrolling back up and down doesn't re-animate.
- Hero + PlaygroundSection visible at full opacity on first paint (no animation).
- Blobs visible behind sections — subtle but discernible:
  - cyan glow behind Hero (top-left)
  - indigo wash behind Problem (right)
  - cyan glow behind Solution (left)
  - amber wash through Receipts → Comparison (center)
  - amber wash continuing through Features → Code (right)
  - cyan crescendo behind CTA (center, brightest)
- DevTools → Emulate `prefers-reduced-motion: reduce` → reload → sections render at full opacity from first paint, no animation.
- No console errors or hydration mismatches.
- Mobile (<640px): sections still animate; blobs still positioned. Some blobs may bleed off-screen on narrow viewports — that's expected and visually fine (the part visible just renders the inner half of the radial gradient).

### Pre-merge browser inspection (optional)

Boot dev, take a screenshot of the page in three states:

- First paint (Hero + PlaygroundSection visible, body sections opacity 0).
- Mid-scroll (Problem + Solution animated in; Receipts onward still 0).
- Bottom (CTA animated in, full page revealed).

Confirm the cool→warm→cool arc reads correctly via the blob positions.

## 7. Out of scope / handoff to 2.C + Phase 3

**Phase 2.C:**

- MDX content support across the seven sections.
- Update `docs/superpowers/specs/2026-04-21-pretable-visual-system-design.md` to reflect the cool-slate AI-startup pivot (or replace with a new visual system spec).
- Next.js + RSC unit-test setup. Backfill tests for ScrollReveal + LandingAmbient if/when the suite lands.
- Real-time bench data feeds for `<ComparisonTable />` / `<ReceiptsBand />`.
- Stagger animation inside `<FeatureGrid>` (cards entering in sequence).

**Phase 3:**

- Retire `apps/playground` — `<Nav>` LINKS pruning, app deletion.

**Other follow-ups (not committed to a phase):**

- Hero parallax effect (dawn has `<HeroEarthParallax />` — earth + starfield + sun bloom). Could land as Phase 2.D if the user wants more visual polish on the hero.
- Theming-architecture work for external `@pretable/*` consumers (separately tracked).
- Vercel project + domain wiring.

## 8. Rollback

Single-PR squash-merge. Revertable atomically:

- `git revert` removes both new component files, restores `layout.tsx` and `page.tsx` to their Phase 2.A shape. Page renders the body sections at full opacity from first paint with no blobs (just the page gradient). No data migrations.

## 9. Risks

| Risk                                                                                                                                         | Mitigation                                                                                                                                                                                                                                                                              |
| -------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Hardcoded `top:` values for blobs become wrong if a section's height changes (e.g., Phase 2.C adds copy to Problem, pushing everything down) | Code comment in `LandingAmbient.tsx` explicitly documents the measurement methodology + how to re-tune. Phase 2.C author re-measures if they touch section heights.                                                                                                                     |
| `IntersectionObserver` not supported in target browsers                                                                                      | All evergreen browsers support it natively; Next.js 16 already requires modern targets. No polyfill needed.                                                                                                                                                                             |
| Reduced-motion override doesn't actually fire                                                                                                | Tested manually via DevTools in pre-merge smoke. The Tailwind `motion-reduce:` variant compiles to a `@media (prefers-reduced-motion: reduce)` block — can verify in compiled CSS.                                                                                                      |
| Blobs visually compete with the page gradient                                                                                                | First-pass alphas (0.08-0.18) are tuned subtle. If the gradient washes them out at viewport scale, alphas can be bumped up in a follow-up. Conservative defaults.                                                                                                                       |
| Animation feels too slow / too fast at 700ms                                                                                                 | First-pass; can be tuned. Faster than 500ms reads as flicker; slower than 900ms reads as sluggish. 700ms is the dawn-equivalent sweet spot.                                                                                                                                             |
| `<ScrollReveal>` opacity-0 hides content from search engines / accessibility tools                                                           | Search engines render the SSR HTML which has no opacity-0 (only after JS hydration does the class apply). For a11y, screen readers see the content tree — opacity is visual-only, not inert. Tab-key navigation reaches hidden elements normally (no `tabindex=-1`, no `display:none`). |

## 10. Success criteria

Phase 2.B is successful if:

1. Landing renders the seven body sections with one-shot fade+slide-up animation as the user scrolls.
2. Six ambient blobs render behind transparent section backgrounds at the spec'd colors / sizes / scroll positions, implementing the cool→cold→cyan→amber→amber→cyan narrative arc.
3. Hero + PlaygroundSection animate normally (no enhancement; they're above-the-fold).
4. `prefers-reduced-motion: reduce` users see all sections at full opacity from first paint with no animation.
5. CI green across the repo. No new dependencies. No measurable bundle size impact beyond the ~1 KB ScrollReveal client bundle.
6. Manual smoke: subtle but real depth + pacing improvement vs Phase 2.A's flat-from-first-paint experience.

---

**End of spec.** Implementation plan follows via `superpowers:writing-plans` after user approval.
