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
