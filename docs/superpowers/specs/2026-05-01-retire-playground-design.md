# Retire `apps/playground` — Design Spec

**Date:** 2026-05-01
**Status:** Draft for review

---

## 1. Goal

The standalone `apps/playground` is obsolete. `apps/website` now embeds the same live grid via `PlaygroundSection` (Phase 2.A). Maintaining two surfaces for the same demo costs build/test/CI time and confuses contributors. Phase 3 deletes the app, narrows public types, and tightens website copy.

## 2. Deliverables

### 2.1 Delete `apps/playground/`

Remove the entire directory: `apps/playground/{src,package.json,tsconfig.json,vite.config.ts,index.html,...}`. No file outside the directory imports `@pretable/app-playground` (verified via `grep -l "app-playground" apps/*/package.json packages/*/package.json` — only `apps/playground/package.json` matches itself).

### 2.2 Narrow `NavPage` type

`packages/ui/src/nav.tsx:1`:

```ts
// before
export type NavPage = "playground" | "website" | "bench" | "docs" | "github";

// after
export type NavPage = "website" | "bench" | "docs" | "github";
```

The `LINKS` array (line 17) does not contain a `"playground"` entry, so no runtime change is needed there.

### 2.3 Update `packages/ui/src/__tests__/nav.test.tsx`

The file uses `active="playground"` in five places (lines 9, 19, 43, 50, 54) and references "playground" in the link-count comment (line 27) and a CTA label (`label: "Try playground →"` line 51). All test assertions should be retargeted to a remaining `NavPage` value (`"website"` is the natural choice — every page has a primary "go home" link).

Specifically:

- Replace `active="playground"` → `active="website"` in all five tests.
- Update the comment at line 27 from `// playground, bench, docs, github` to `// website, bench, docs, github`.
- Update the CTA label `"Try playground →"` to `"Try it live →"` and adjust the matching `screen.getByRole("link", { name: /try playground/i })` to `/try it live/i`.

The `toHaveLength(4)` assertion stays — `LINKS` still has four entries.

### 2.4 Drop `dev:playground` from root `package.json`

Remove the line `"dev:playground": "pnpm --filter @pretable/app-playground dev"`. Other scripts (`dev:website`, `dev:bench`, `dev:streaming-demo`) stay.

### 2.5 Refresh stale comment in `apps/website/app/layout.tsx`

Line 30 currently reads:

```tsx
{
  /* TODO(ci-signal): wire ciStatus to a real source once CI status plumbing exists.
            Hardcoded "green" for now — parity with apps/playground/src/app.tsx. */
}
```

Replace with:

```tsx
{
  /* TODO(ci-signal): wire ciStatus to a real source once CI status plumbing exists.
            Hardcoded "green" for now. */
}
```

### 2.6 Tighten CTA copy on the website

Two anchors on the landing page direct readers at the embedded grid section. After retirement, "playground" is an orphaned word — the standalone app no longer exists.

- `apps/website/app/components/Hero.tsx`: `Try the playground ↓` → `Try it live ↓`
- `apps/website/app/components/CtaSection.tsx`: `Try the playground ↑` → `Try it live ↑`

The `href` targets (`#grid`) and the section's `id="grid"` stay unchanged.

## 3. Non-goals

- Renaming `PlaygroundSection.tsx` (the component file). Stable file name; only the user-facing copy shifts.
- Renaming the section anchor from `#grid` to anything else.
- Modifying the playground's tests in any way other than deleting them with the rest of the directory.
- Touching `apps/bench` or `apps/streaming-demo`.
- Documentation changes outside the layout.tsx comment.

## 4. Verification

- `pnpm install` — succeeds; lockfile updates to remove the deleted workspace.
- `pnpm test` — all workspaces still pass (no test references the removed app).
- `pnpm build` — all workspaces still build (no consumer imports the app).
- `pnpm lint` and `pnpm format` — clean.
- `pnpm typecheck` — clean (the narrower `NavPage` union has no consumer outside `packages/ui` per `grep -rn "NavPage" packages/ apps/`).
- `apps/website` smoke tests still pass (Hero / CtaSection tests assert tag presence, not link text).

## 5. Risks

- **Lockfile churn.** `pnpm-lock.yaml` will lose entries for `@pretable/app-playground`. This is mechanical and expected; no special handling required.
- **`grep` discovers an unrelated "playground" reference at implementation time.** Mitigation: implementation should run a final `grep -rn "playground\|Playground" --include="*.{ts,tsx,json,md,yaml}"` after deletions and confirm any remaining matches are intentional (e.g., `PlaygroundSection.tsx` filename stays; the LandingAmbient comment block still references "Playground height" as a section name in the height-tuning workflow — those are fine, they describe the on-website section, not the deleted app).
- **Memory note drift.** User's auto-memory file `project_website_pivot_after_b.md` says "after direction B ships, **rename** apps/playground." That intent has been superseded by retirement (the website now embeds the demo). The memory file isn't checked into this repo and isn't touched by this spec.

## 6. Rollback

Revert the squash-merge commit. `pnpm install` after revert restores the workspace.

## 7. Out of scope

See §3.

## 8. Success criteria

- [ ] `apps/playground/` is gone.
- [ ] `NavPage` type no longer includes `"playground"`.
- [ ] `pnpm test`, `pnpm build`, `pnpm lint`, `pnpm typecheck`, `pnpm format` all green locally and in CI.
- [ ] Website CTAs read "Try it live ↓ / ↑".
- [ ] `apps/website/app/layout.tsx` no longer references the deleted directory.
- [ ] Single PR.
