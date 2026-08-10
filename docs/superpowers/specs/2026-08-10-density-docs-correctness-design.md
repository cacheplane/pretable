# Docs teach imports that do not exist

Date: 2026-08-10
Status: approved

## Problem

`apps/website/content/docs/` instructs readers to write imports that cannot
compile against the published package.

- `packages/react/src/public_api.ts:93-94` exports **only**
  `ɵuseResolvedHeights` and `ɵmeasureRenderedRowHeight`. The `ɵ` prefix is this
  repo's convention for "internal, not public API" (see also
  `ɵROW_SELECT_COLUMN_ID`).
- `grid/custom-rendering.mdx:52` contains
  `import { useResolvedHeights, usePretable } from "@pretable/react";`
- `grid/density-helpers.mdx:15` does the same, and that page is built entirely
  around the unprefixed names.
- **Eleven** docs pages reference these helpers by unprefixed name.

A reader copying any of it gets a compile error, against a package published on
npm.

## The decision, and why

**The exports are right; the docs are wrong.** The code says so explicitly:

`packages/react/src/density.ts:21-27`:

> React hook returning the current density heights derived from the active CSS
> theme. **Internal** — `<Pretable>` and `<PretableSurface>` use this; **external
> consumers should reach for `getDensityHeights` from `@pretable/ui`**.
> `@internal`

`packages/react/src/row-height.ts:70-73`:

> DOM measurement helper used internally by the surface's row-height accounting.
> **Not part of the user-facing API.** `@internal`

And the public alternative exists and is documented as such —
`packages/ui/src/density.ts`, `@public`:

> Synchronous snapshot of the resolved density-related CSS variables… **For
> non-React consumers, tests, custom virtualizers, and power users.** The
> reactive React hook (`useResolvedHeights`) lives in `@pretable/react`.

`packages/ui/src/public_api.ts:8` exports exactly `getDensityHeights` and
`DensityHeights`, and nothing else.

So the library's intent is unambiguous. Promoting the hook would contradict its
own contract and commit us to supporting re-render semantics we would then owe
consumers.

**The one genuine gap:** `getDensityHeights` is a _synchronous snapshot_, so a
React consumer wanting density that reacts to a theme or density swap has no
public API. The internal hook is `useSyncExternalStore` over a `MutationObserver`
watching `data-density`, `data-theme`, `class` and `style` on
`document.documentElement` — roughly twenty lines. **Teach that pattern as
example code rather than shipping it.** A reader who needs it can paste it and
owns its behaviour; we keep the surface small and stay free to change ours.

Note the `@pretable/ui` doc comment quoted above points at the React hook as
though it were reachable. Correct it too — it is the same error, in the source
rather than the docs.

## Scope

In: the eleven docs pages, `density-helpers.mdx`'s reason for existing, the
`@pretable/ui` source comment, `pretable-surface.mdx`'s props table, and a
mechanism to stop this class recurring.

Out: any change to what `@pretable/react` or `@pretable/ui` export.

## Design

### 1. Redirect every reference

Rewrite each of the eleven pages onto `getDensityHeights` from `@pretable/ui`.
Every code block must be one a reader can paste and compile against the
published `0.0.11` — verify against `packages/ui/ui.api.md`, not against this
spec.

`density-helpers.mdx` keeps its slot but changes subject: it becomes the page
about `getDensityHeights` — what it reads, its SSR behaviour, its fallbacks —
plus the reactive-wrapper recipe below.

**`measureRenderedRowHeight` has no public counterpart.** Do not redirect it;
remove it from the docs. If a page's example genuinely depends on measuring a
rendered row, rewrite the example so it does not, or drop it. Do not invent a
replacement.

### 2. The reactive recipe

One worked example, in `density-helpers.mdx`, that a reader can copy: a small
`useDensityHeights` built on `useSyncExternalStore` + `MutationObserver` over
`getDensityHeights`. Say plainly that it is example code they own, not an API
we ship, and why — so nobody files a bug when our internal version diverges.

### 3. `pretable-surface.mdx`

Its props table is materially wrong: it omits roughly ten shipped props
(`onCellEdit`, `onPaste`, `onCopy`, `onFiltersChange`, `onRowActivate`,
`onRowSelectionChange`, `rowSelectionColumn`, `copyToClipboard`,
`copyWithHeaders`, `messages`), marks `viewportHeight` optional when the type
requires it, and marks `getRowId` required when the type does not.

Verify that list against `packages/react/react.api.md` rather than trusting it —
it comes from one audit.

### 4. Stop the class recurring

This is the third time a hand-maintained docs table has drifted from the code:
`api-reference.mdx`'s `PretableColumn` (missing five fields, #273),
`pretable-surface.mdx` (above), and these imports.

Build a test that compares documented API surface against the generated
`.api.md` reports. It does not have to be complete to be worth having — a check
that every identifier a docs page claims to import from `@pretable/*` actually
appears as an export in that package's report would have caught **all three** of
these, and is a parse-and-compare over files we already generate.

Model it on `packages/grid-core/src/__tests__/column-model-reconciliation-invariant.test.ts`
(#266): fail closed, and put the remedy in the failure message.

**Prove it works.** Reintroduce one broken import on a scratch commit, confirm
the test fails naming it, then revert. Report that result — a mechanism that
cannot catch the bug it was built for is worse than none, because it licenses
confidence.

If a genuinely useful check is not achievable here, say so with evidence and
propose the strongest achievable alternative rather than shipping something
shaped like a guard.

## Testing

- `pnpm build` catches MDX compile errors but **not** broken relative links or
  wrong imports inside fenced blocks — those are exactly what §4 is for.
- Re-run the `/docs/*` link check across every touched page.
- The docs e2e spec should still pass unchanged.
