# Shared React Renderer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extract one internal React renderer surface that unifies `Pretable` and the playground inspection grid on the same DOM, measurement, pinned-layout, and interaction path without breaking the benchmark contract.

**Architecture:** Keep `usePretableModel()` as the public low-level hook, then build an internal `PretableSurface` that owns the scroll viewport, header row, pinned offsets, row shells, measurement loop, keyboard handling, selection/focus visuals, and sort behavior. `Pretable` becomes a thin default wrapper, and the playground inspection demo composes the same internal surface with richer content while leaving toolbar/sidebar chrome outside.

**Tech Stack:** `pnpm`, TypeScript, React, Vitest, Vite, Playwright

---

## File Structure Map

### New internal renderer files

- Create: `/Users/blove/.config/superpowers/worktrees/pretable/codex/pretable-monorepo-scaffold/packages/react/src/internal/pretable-surface.tsx`
- Create: `/Users/blove/.config/superpowers/worktrees/pretable/codex/pretable-monorepo-scaffold/packages/react/src/internal/rendering.ts`
- Create: `/Users/blove/.config/superpowers/worktrees/pretable/codex/pretable-monorepo-scaffold/packages/react/src/internal/styles.ts`
- Create: `/Users/blove/.config/superpowers/worktrees/pretable/codex/pretable-monorepo-scaffold/packages/react/src/internal/__tests__/pretable-surface.test.tsx`

### React public adapter updates

- Modify: `/Users/blove/.config/superpowers/worktrees/pretable/codex/pretable-monorepo-scaffold/packages/react/src/pretable.tsx`
- Modify: `/Users/blove/.config/superpowers/worktrees/pretable/codex/pretable-monorepo-scaffold/packages/react/src/use-pretable.ts`
- Modify: `/Users/blove/.config/superpowers/worktrees/pretable/codex/pretable-monorepo-scaffold/packages/react/src/index.ts`
- Modify: `/Users/blove/.config/superpowers/worktrees/pretable/codex/pretable-monorepo-scaffold/packages/react/src/__tests__/pretable.test.tsx`

### Playground integration

- Modify: `/Users/blove/.config/superpowers/worktrees/pretable/codex/pretable-monorepo-scaffold/apps/playground/src/inspection-demo.tsx`
- Modify: `/Users/blove/.config/superpowers/worktrees/pretable/codex/pretable-monorepo-scaffold/apps/playground/src/__tests__/inspection-demo.test.tsx`
- Modify: `/Users/blove/.config/superpowers/worktrees/pretable/codex/pretable-monorepo-scaffold/apps/playground/src/app.css`

### Benchmark compatibility checks

- Modify: `/Users/blove/.config/superpowers/worktrees/pretable/codex/pretable-monorepo-scaffold/apps/bench/src/pretable-adapter.tsx`
- Modify: `/Users/blove/.config/superpowers/worktrees/pretable/codex/pretable-monorepo-scaffold/apps/bench/src/__tests__/bench-app.test.tsx`
- Modify: `/Users/blove/.config/superpowers/worktrees/pretable/codex/pretable-monorepo-scaffold/apps/bench/tests/bench.spec.ts`

### Notes and memory

- Modify: `/Users/blove/.config/superpowers/worktrees/pretable/codex/pretable-monorepo-scaffold/docs/research/repo-memory.md`

## Task 1: Define the internal renderer contract and lock the benchmark-sensitive behavior

**Files:**

- Create: `/Users/blove/.config/superpowers/worktrees/pretable/codex/pretable-monorepo-scaffold/packages/react/src/internal/__tests__/pretable-surface.test.tsx`
- Create: `/Users/blove/.config/superpowers/worktrees/pretable/codex/pretable-monorepo-scaffold/packages/react/src/internal/pretable-surface.tsx`
- Create: `/Users/blove/.config/superpowers/worktrees/pretable/codex/pretable-monorepo-scaffold/packages/react/src/internal/rendering.ts`
- Create: `/Users/blove/.config/superpowers/worktrees/pretable/codex/pretable-monorepo-scaffold/packages/react/src/internal/styles.ts`

- [ ] **Step 1: Write the failing renderer tests**

Write tests that prove an internal `PretableSurface` can:

- render the Pretable benchmark markers on the real scrolling subtree
- render header buttons that reflect sort state and dispatch sort changes
- honor `column.getValue` for body-cell content
- apply pinned-left sticky offsets to header and body cells
- expose focus/selection state on rows and cells
- run keyboard navigation with `ArrowUp`, `ArrowDown`, `Enter`, and `Space`
- capture measured row heights through the row shell and feed changed heights back

- [ ] **Step 2: Run the focused React renderer test to verify RED**

Run: `pnpm --filter @pretable/react test -- --run src/internal/__tests__/pretable-surface.test.tsx`

Expected: FAIL because `PretableSurface` and its helpers do not exist yet.

- [ ] **Step 3: Implement the minimal internal renderer contract**

Create a renderer component and helpers that own:

- the scroll viewport and scroll content wrappers
- the sticky header row
- width fallback and pinned-offset math
- accessor-aware value resolution
- row shells with `data-pretable-row`, `data-row-id`, `data-row-index`, `data-row-height`
- cell shells with `data-pretable-cell`
- sort-button event wiring
- keyboard handling for focus movement and row selection
- measurement callback plumbing keyed by row id

Keep callbacks narrow. Header/body callbacks may control inner content only.

- [ ] **Step 4: Run the focused React renderer test to verify GREEN**

Run: `pnpm --filter @pretable/react test -- --run src/internal/__tests__/pretable-surface.test.tsx`

Expected: PASS

- [ ] **Step 5: Run React-package lint and typecheck**

Run:

- `pnpm --filter @pretable/react lint`
- `pnpm --filter @pretable/react typecheck`

Expected: PASS

- [ ] **Step 6: Commit the internal renderer contract**

```bash
git add packages/react/src/internal packages/react/src/use-pretable.ts
git commit -m "feat: add internal react grid surface"
```

## Task 2: Move the public `Pretable` component onto the shared surface

**Files:**

- Modify: `/Users/blove/.config/superpowers/worktrees/pretable/codex/pretable-monorepo-scaffold/packages/react/src/pretable.tsx`
- Modify: `/Users/blove/.config/superpowers/worktrees/pretable/codex/pretable-monorepo-scaffold/packages/react/src/__tests__/pretable.test.tsx`

- [ ] **Step 1: Write or extend failing `Pretable` tests**

Add tests that prove the public `Pretable` wrapper:

- still exposes benchmark DOM markers
- preserves row ids from `getRowId`
- still measures wrapped rows and updates `data-row-height`
- renders accessor-driven values correctly through the shared surface
- still virtualizes rows on scroll

- [ ] **Step 2: Run the focused `Pretable` test to verify RED**

Run: `pnpm --filter @pretable/react test -- --run src/__tests__/pretable.test.tsx`

Expected: FAIL because `Pretable` has not been migrated to the new surface yet.

- [ ] **Step 3: Rewrite `Pretable` as a thin wrapper over `PretableSurface`**

Update `Pretable` so it:

- keeps its current simple look
- delegates DOM structure, sorting, keyboard handling, pinned layout, and measurement to the internal surface
- preserves the benchmark selectors and style policies

Do not add new public API surface in this step beyond what the component already supports.

- [ ] **Step 4: Run the focused `Pretable` test to verify GREEN**

Run: `pnpm --filter @pretable/react test -- --run src/__tests__/pretable.test.tsx`

Expected: PASS

- [ ] **Step 5: Run package verification**

Run:

- `pnpm --filter @pretable/react test`
- `pnpm --filter @pretable/react build`

Expected: PASS

- [ ] **Step 6: Commit the `Pretable` migration**

```bash
git add packages/react/src/pretable.tsx packages/react/src/__tests__/pretable.test.tsx
git commit -m "refactor: move pretable onto shared surface"
```

## Task 3: Move the playground inspection grid onto the shared surface

**Files:**

- Modify: `/Users/blove/.config/superpowers/worktrees/pretable/codex/pretable-monorepo-scaffold/apps/playground/src/inspection-demo.tsx`
- Modify: `/Users/blove/.config/superpowers/worktrees/pretable/codex/pretable-monorepo-scaffold/apps/playground/src/__tests__/inspection-demo.test.tsx`
- Modify: `/Users/blove/.config/superpowers/worktrees/pretable/codex/pretable-monorepo-scaffold/apps/playground/src/app.css`

- [ ] **Step 1: Extend the failing playground tests**

Add or tighten tests that prove the inspection demo still:

- sorts by header clicks rendered from the shared surface
- filters rows while keeping the shared grid DOM intact
- updates selection and detail state through shared row interactions
- moves focus/selection with keyboard events owned by the shared surface
- preserves pinned metadata behavior through the shared renderer

- [ ] **Step 2: Run the playground test to verify RED**

Run: `pnpm --filter @pretable/app-playground test`

Expected: FAIL because the inspection demo still renders its own grid surface.

- [ ] **Step 3: Rewrite the inspection demo to compose `PretableSurface`**

Update the inspection demo so it:

- keeps toolbar, copy, and detail sidebar outside the renderer
- uses the shared surface for header/body rendering, sort handling, keyboard handling, selection/focus visuals, pinned offsets, and measurement
- supplies richer header and body content through narrow render callbacks

Remove duplicated width fallback, pinned offset calculation, and row/cell shell rendering from the playground.

- [ ] **Step 4: Run the playground test to verify GREEN**

Run: `pnpm --filter @pretable/app-playground test`

Expected: PASS

- [ ] **Step 5: Run playground lint, typecheck, and build**

Run:

- `pnpm --filter @pretable/app-playground lint`
- `pnpm --filter @pretable/app-playground typecheck`
- `pnpm --filter @pretable/app-playground build`

Expected: PASS

- [ ] **Step 6: Commit the playground migration**

```bash
git add apps/playground/src/inspection-demo.tsx apps/playground/src/__tests__/inspection-demo.test.tsx apps/playground/src/app.css
git commit -m "refactor: share inspection grid renderer"
```

## Task 4: Verify benchmark compatibility on the shared renderer path

**Files:**

- Modify: `/Users/blove/.config/superpowers/worktrees/pretable/codex/pretable-monorepo-scaffold/apps/bench/src/pretable-adapter.tsx`
- Modify: `/Users/blove/.config/superpowers/worktrees/pretable/codex/pretable-monorepo-scaffold/apps/bench/src/__tests__/bench-app.test.tsx`
- Modify: `/Users/blove/.config/superpowers/worktrees/pretable/codex/pretable-monorepo-scaffold/apps/bench/tests/bench.spec.ts`

- [ ] **Step 1: Write benchmark-facing regression coverage**

Add or tighten tests that prove the Pretable benchmark path still:

- renders the expected Pretable DOM markers
- mounts the expected scroll viewport element
- preserves row identity through `getRowId`
- continues to behave correctly under `runKey` remounts

- [ ] **Step 2: Run the focused bench tests to verify RED**

Run:

- `pnpm --filter @pretable/app-bench test -- --run src/__tests__/bench-app.test.tsx`

Expected: FAIL if the shared renderer migration changed the DOM contract or benchmark assumptions.

- [ ] **Step 3: Adjust the benchmark adapter only as needed**

Keep the Pretable benchmark path thin:

- continue using the public `Pretable` component
- preserve scenario row ids
- do not introduce benchmark-only renderer forks

Only update test assumptions if the DOM contract is intentionally preserved but exposed differently in a harmless way. Do not weaken the benchmark contract.

- [ ] **Step 4: Run focused benchmark verification**

Run:

- `pnpm --filter @pretable/app-bench test -- --run src/__tests__/bench-app.test.tsx`
- `pnpm --filter @pretable/app-bench test`

Expected: PASS

- [ ] **Step 5: Run browser smoke verification for the Pretable benchmark surface**

Run:

- `pnpm bench:e2e -- --project=chromium`

Expected: PASS with valid Pretable summary output and no missing Pretable selector failures.

- [ ] **Step 6: Commit the benchmark-compatibility batch**

```bash
git add apps/bench/src/pretable-adapter.tsx apps/bench/src/__tests__/bench-app.test.tsx apps/bench/tests/bench.spec.ts
git commit -m "test: lock shared renderer benchmark contract"
```

## Task 5: Final verification, documentation, and memory update

**Files:**

- Modify: `/Users/blove/.config/superpowers/worktrees/pretable/codex/pretable-monorepo-scaffold/docs/research/repo-memory.md`

- [ ] **Step 1: Update repo memory**

Add a short note covering:

- the internal-only shared renderer decision
- the fact that header, pinned layout, measurement, keyboard handling, selection/focus visuals, and sort behavior now live on one shared React renderer path
- any known remaining gaps after the extraction

- [ ] **Step 2: Run full workspace verification**

Run:

- `pnpm lint`
- `pnpm test`
- `pnpm typecheck`
- `pnpm build`

Expected: PASS

- [ ] **Step 3: Review the final diff**

Run:

- `git diff --stat HEAD~4..HEAD`
- `git status --short`

Expected:

- worktree clean except for the memory note if not yet committed
- no accidental public API expansion beyond the intended internal renderer extraction

- [ ] **Step 4: Commit the documentation/final cleanup**

```bash
git add docs/research/repo-memory.md package.json
git commit -m "docs: record shared renderer extraction"
```

- [ ] **Step 5: Prepare completion handoff**

Be ready to report:

- which files now define the internal renderer seam
- which benchmark selectors and policies were preserved
- what still remains before the renderer should become public API
