# @pretable/app-website

The pretable marketing landing page. Grid-as-hero layout: a full-viewport live streaming grid is the first thing visitors see, with marketing content in a slide-up drawer beneath it. Two route trees: `/` (landing) and `/docs/*` (MDX-driven documentation surface).

This README is **living documentation** of the visual system as it exists today. It supersedes the proposal at `docs/superpowers/specs/2026-04-21-pretable-visual-system-design.md`.

## Tokens

The website's color and typography tokens live locally in `app/styles/cool-slate-tokens.css` (`--pt-*` namespace). They were originally housed in a now-deleted `@pretable/ui` package; that package name is reserved for the upcoming public theming package (see `docs/superpowers/specs/2026-05-01-pretable-theming-architecture-design.md`), which writes a different `--pretable-*` namespace. The two namespaces are intentionally distinct and don't collide.

`app/globals.css` imports the tokens (excerpt):

```css
@import "./styles/cool-slate-tokens.css";
@import "./styles/marketing-components.css";
```

(See `app/globals.css` for the full top-of-file import block — fonts, then the tokens above, then Tailwind.)

The Tailwind theme block in `globals.css` exposes them as `--color-*` shortcuts (e.g., `bg-bg-page`, `text-text-primary`, `text-accent`). For the canonical token list and values, read `app/styles/cool-slate-tokens.css`. Don't restate values here — pointer-only.

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

- **Fraunces Variable** — display / serif (hero, section headlines). Canonical: `--pt-font-serif`. Tailwind alias: `font-display`.
- **Inter Variable** — sans body. Canonical: `--pt-font-sans`. Tailwind alias: `font-sans`.
- **JetBrains Mono Variable** — code, eyebrow labels, grid cells. Canonical: `--pt-font-mono`. Tailwind alias: `font-mono`.

## Palette

Light mode by default. The **Alpenglow palette** is defined in `app/styles/cool-slate-tokens.css`:

| Role           | Token            | Value      |
| -------------- | ---------------- | ---------- |
| Page bg        | `--pt-bg-page`   | warm cream |
| Accent         | `--pt-accent`    | dusk peach |
| Cool highlight | `--pt-cool`      | cobalt     |
| Drawer bg      | `--pt-drawer-bg` | dark slate |

## Page layout

`app/page.tsx` renders the full page in this order:

1. **`<RouteAwareNav>`** — top navigation bar (shared with `/docs`).
2. **`<HeroGrid>`** — full-bleed live streaming demo. The grid is the hero: a real `@pretable/react` instance running a live receipts feed, full-viewport.
3. **`<DrawerHandle>`** — pill pinned to the bottom of the viewport; click or swipe up to open the drawer.
4. **`<Drawer>`** — overlay drawer containing six content sections in order:

   | #   | Component         | Role                                                                    |
   | --- | ----------------- | ----------------------------------------------------------------------- |
   | 1   | `ReceiptsBand`    | Numbers + positioning cards + problem callout ("receipts, not claims"). |
   | 2   | `ComparisonTable` | Cell-by-cell adapter comparison with trail markers per adapter.         |
   | 3   | `HowItWorks`      | Architecture explainer.                                                 |
   | 4   | `CodeExample`     | Single-import code snippet (shiki).                                     |
   | 5   | `FeatureGrid`     | Four feature cards with trail markers.                                  |
   | 6   | `CtaSection`      | Install command + GitHub link.                                          |

   Sections 2–6 inside the drawer are wrapped in `<ScrollReveal>`. `ReceiptsBand` is rendered bare (visible on drawer open).

5. **`<MountainFooter>`** — mountain silhouette footer. This is the only ski/mountain motif on the page; the hero and drawer do not repeat it.

### DOM-first SEO

Full marketing content is always rendered server-side; JavaScript hydration upgrades the layout to an overlay drawer at viewport widths ≥ 768 px. At narrower widths (< 768 px), the drawer renders as a natural scroll page — no overlay, no `DrawerHandle` toggle, all sections in document flow.

### Responsive and accessibility behaviour

- **Mobile (< 768 px):** natural scroll page, no drawer overlay.
- **`prefers-reduced-motion`:** drawer slide animation is disabled; hero replay falls back to a static 50-row snapshot instead of the live streaming animation.

## Trail markers

`<TrailMarker>` is used in `ComparisonTable` and `FeatureGrid` as ski-difficulty metaphors. Four variants:

| Variant        | Symbol       | Meaning       |
| -------------- | ------------ | ------------- |
| `green`        | circle       | easiest       |
| `blue`         | square       | intermediate  |
| `black`        | diamond      | expert        |
| `double-black` | two diamonds | most advanced |

## Narrative scaffolding

### `<ScrollReveal>` (client component)

`app/components/ScrollReveal.tsx` — IntersectionObserver one-shot pattern. When a wrapped section first crosses 20% visibility, it animates from `opacity: 0; translateY(24px)` → `opacity: 1; translateY(0)` over 700ms with `ease-out`. After the first reveal, the observer disconnects — sections never re-animate on scroll-back. Respects `prefers-reduced-motion: reduce` (drops the translate, keeps opacity).

## Adding a new section

1. Create `app/components/Foo.tsx` as a server component (default). Use `"use client"` only if the section needs hooks or browser APIs.
2. Import tokens via Tailwind class names (`text-text-primary`, `bg-bg-card`, etc.) — no inline color hex values.
3. Render in `app/page.tsx` inside `<Drawer>`. Wrap it in `<ScrollReveal>` unless it should be visible immediately on drawer open.
4. Add a smoke test at `__tests__/components/Foo.test.tsx` using the existing pattern (render + one assertion).

## Testing

`apps/website/__tests__/` holds Vitest smoke tests only — one per top-level component plus the home page. Each test renders the component and asserts something stable (a heading exists, a wrapper renders, the code block is present). No interaction tests, no snapshots, no visual regression. The goal is to catch import-level breakage in CI, not to assert visual correctness.

Run locally: `pnpm --filter @pretable/app-website test`.

`apps/website/e2e/` holds Playwright **production smoke** specs. They run against the deployed origin (`BASE_URL`, defaults to `https://pretable.vercel.app`) and assert the hero grid (`[data-pretable-scroll-viewport]`), the drawer handle (`[data-testid="drawer-handle"]`), the mountain footer tagline, and the `/docs` route. The spec is excluded from Vitest discovery via `vitest.config.ts`.

Run locally against prod: `pnpm --filter @pretable/app-website smoke`.

## Deploys

Production deploys are owned by `.github/workflows/ci.yml`, **not** Vercel's git integration. The Vercel project's "Ignored Build Step" is set to `exit 0` server-side so `git push` to GitHub does not trigger a Vercel build directly — CI is the single source.

Two jobs in `ci.yml` handle this:

- `deploy-prod` — runs on push to `main`, gated on `test`, `typecheck`, `lint`, `format`, `build` passing. Calls `vercel pull --environment=production` → `vercel build --prod` → `vercel deploy --prebuilt --prod`, waits for the public alias `pretable.vercel.app` to atomically swap, then runs the Playwright smoke against the live origin. Traces are uploaded as an artifact on failure.
- `deploy-preview` — runs on `pull_request` events. Calls `vercel pull --environment=preview` → `vercel build` → `vercel deploy --prebuilt`, then posts (or updates) a sticky comment on the PR with the preview URL. Preview URLs (`*-cacheplane.vercel.app`) are gated by Vercel deployment protection — load them while signed into the `cacheplane` Vercel team.

Live origins:

- Production alias: <https://pretable.vercel.app>
- Custom domain: <https://pretable.ai> (added to the project; DNS via Vercel nameservers)

Required GitHub secrets (managed at the repo level): `VERCEL_TOKEN`, `VERCEL_ORG_ID`, `VERCEL_PROJECT_ID`.
