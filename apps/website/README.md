# @pretable/app-website

The pretable website (cool-slate AI-startup landing). Next.js 16 + Tailwind v4 + MDX-ready.

## Phases

- **Phase 1 (this PR):** scaffold + hero + live playground grid section directly below.
- **Phase 2:** AI-startup body sections (problem / solution / stack / CTA), ScrollReveal animations, ambient blob narrative.
- **Phase 3:** Retire `apps/playground` (its hero + grid pattern lives here now).

See `docs/superpowers/specs/2026-04-24-website-phase-1-design.md` for the design.

## Local dev

```bash
pnpm --filter @pretable/app-website dev
```

## Deployment

Vercel-ready. Project + domain wiring deferred (manual step when ready).
