# SSR Density Hydration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Hydrate Pretable's CSS-resolved geometry from deterministic server snapshots, then adopt active theme values without React recovery.

**Architecture:** Keep computed-style reads in the client snapshots for both density hooks, but give each hook a distinct deterministic server snapshot. Pin the React contract with a direct `renderToString` to `hydrateRoot` regression, protect the populated virtualized surface in Playwright, and document the actual fallback behavior.

**Tech Stack:** React 19, TypeScript, `useSyncExternalStore`, Vitest/jsdom, Testing Library, Playwright, Next.js, Changesets.

**Design:** `docs/superpowers/specs/2026-08-09-ssr-density-hydration-design.md`

---

## File map

- Create `packages/react/src/__tests__/density-hydration.test.tsx` — faithful Node-SSR-to-browser-hydration coverage for both sizing hooks and explicit prop precedence.
- Modify `packages/react/src/__tests__/density.test.ts` — client contract coverage for `useResolvedPx`, including its disabled fast path.
- Modify `packages/react/src/density.ts` — deterministic server snapshots; client CSS subscription remains unchanged.
- Modify `apps/website/e2e/grouping.spec.ts` — cold-load hydration recovery and final geometry regression for a populated grouped surface.
- Modify `apps/website/content/docs/grid/density-helpers.mdx` — correct the header fallback and distinguish hydration from the later client snapshot.
- Create `.changeset/honest-density-hydration.md` — patch release intent for `@pretable/react`.

## Task 1: Add the hydration regressions and prove RED

**Files:**

- Create: `packages/react/src/__tests__/density-hydration.test.tsx`
- Modify: `apps/website/e2e/grouping.spec.ts`

- [ ] **Step 1: Add the fallback-to-CSS hook regression**

Create `packages/react/src/__tests__/density-hydration.test.tsx` with a probe that exercises both broken server snapshots:

```tsx
import { act } from "@testing-library/react";
import { hydrateRoot, type Root } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterEach, expect, test, vi } from "vitest";

import { useResolvedHeights, useResolvedPx } from "../density";

function DensityProbe() {
  const { rowHeight, headerHeight } = useResolvedHeights();
  const panelHeight = useResolvedPx("--pretable-group-panel-height", 36);
  return <output>{`${rowHeight}:${headerHeight}:${panelHeight}`}</output>;
}

function HeightsProbe({ rowHeight }: { rowHeight: number }) {
  const resolved = useResolvedHeights(rowHeight);
  return <output>{`${resolved.rowHeight}:${resolved.headerHeight}`}</output>;
}

afterEach(() => {
  vi.unstubAllGlobals();
  document.documentElement.removeAttribute("style");
});

test("hydrates fallback geometry before adopting CSS values", async () => {
  vi.stubGlobal("document", undefined);
  const serverHtml = renderToString(<DensityProbe />);
  vi.unstubAllGlobals();
  expect(serverHtml).toContain(">32:36:36</output>");

  document.documentElement.style.setProperty("--pretable-row-height", "48px");
  document.documentElement.style.setProperty(
    "--pretable-header-height",
    "52px",
  );
  document.documentElement.style.setProperty(
    "--pretable-group-panel-height",
    "44px",
  );

  const container = document.createElement("div");
  container.innerHTML = serverHtml;
  document.body.append(container);
  const recoverableErrors: unknown[] = [];
  let root: Root | undefined;

  try {
    await act(async () => {
      root = hydrateRoot(container, <DensityProbe />, {
        onRecoverableError: (error) => recoverableErrors.push(error),
      });
    });
    expect(container.textContent).toBe("48:52:44");
    expect(recoverableErrors).toEqual([]);
  } finally {
    await act(async () => root?.unmount());
    container.remove();
  }
});
```

- [ ] **Step 2: Run the fallback regression and verify the expected failure**

Run:

```bash
pnpm --filter @pretable/react test density-hydration.test.tsx
```

Expected: FAIL only because `onRecoverableError` contains React's hydration mismatch showing client `48:52:44` against server `32:36:36`. The server markup and final client text assertions must already pass.

- [ ] **Step 3: Add the mixed explicit-prop hydration regression**

Append:

```tsx
test("preserves explicit heights while implicit heights adopt CSS", async () => {
  vi.stubGlobal("document", undefined);
  const serverHtml = renderToString(<HeightsProbe rowHeight={77} />);
  vi.unstubAllGlobals();
  expect(serverHtml).toContain(">77:36</output>");

  document.documentElement.style.setProperty("--pretable-row-height", "48px");
  document.documentElement.style.setProperty(
    "--pretable-header-height",
    "52px",
  );

  const container = document.createElement("div");
  container.innerHTML = serverHtml;
  document.body.append(container);
  const recoverableErrors: unknown[] = [];
  let root: Root | undefined;

  try {
    await act(async () => {
      root = hydrateRoot(container, <HeightsProbe rowHeight={77} />, {
        onRecoverableError: (error) => recoverableErrors.push(error),
      });
    });
    expect(container.textContent).toBe("77:52");
    expect(recoverableErrors).toEqual([]);
  } finally {
    await act(async () => root?.unmount());
    container.remove();
  }
});
```

- [ ] **Step 4: Run both hook regressions and verify RED**

Run the focused Vitest command from Step 2.

Expected: 2 failing tests, both at the empty `recoverableErrors` assertion, with the explicit row height remaining `77` throughout.

- [ ] **Step 5: Add the populated-surface browser regression**

Add this near the top of `apps/website/e2e/grouping.spec.ts`, before the interaction tests:

```tsx
test("cold SSR hydration adopts theme geometry without recovery", async ({
  page,
}) => {
  const hydrationErrors: string[] = [];
  const hydrationMessage =
    /hydration|server rendered html|Minified React error #418/i;

  page.on("pageerror", (error) => {
    hydrationErrors.push(`pageerror: ${error.message}`);
  });
  page.on("console", (message) => {
    if (hydrationMessage.test(message.text())) {
      hydrationErrors.push(`console: ${message.text()}`);
    }
  });

  await page.goto(FIXTURE, { waitUntil: "domcontentloaded" });
  await waitForGridReady(page);

  const geometry = await page.evaluate(() => {
    const viewport = document.querySelector<HTMLElement>(
      "[data-pretable-scroll-viewport]",
    );
    const panel = document.querySelector<HTMLElement>(
      "[data-pretable-group-panel]",
    );
    const header = document.querySelector<HTMLElement>(
      "[data-pretable-header-row]",
    );
    if (!viewport || !panel || !header) {
      throw new Error("grouping fixture geometry is incomplete");
    }
    return {
      headerHeight: parseFloat(getComputedStyle(header).height),
      panelHeight: parseFloat(getComputedStyle(panel).height),
      renderedRows: viewport.querySelectorAll("[data-pretable-row-id]").length,
    };
  });

  expect(geometry).toEqual({
    headerHeight: 52,
    panelHeight: 44,
    renderedRows: 13,
  });
  expect(hydrationErrors).toEqual([]);
});
```

- [ ] **Step 6: Start a tracked local server with the unfixed package build**

Confirm port 43179 is free:

```bash
lsof -nP -iTCP:43179 -sTCP:LISTEN
```

Expected: no output. Then start and retain the returned terminal session:

```bash
pnpm --filter @pretable/app-website dev --hostname localhost --port 43179
```

Wait for Next.js to report ready and confirm `http://localhost:43179/fixtures/grouping` returns HTTP 200.

- [ ] **Step 7: Run the browser regression and verify RED**

Run:

```bash
BASE_URL=http://localhost:43179 pnpm --filter @pretable/app-website smoke grouping.spec.ts --project=chromium --grep "cold SSR hydration"
```

Expected: FAIL because `hydrationErrors` contains React's hydration recovery error. The final Material geometry assertion must pass.

- [ ] **Step 8: Stop the exact server and verify cleanup**

Send Ctrl-C to the tracked terminal session. Verify:

```bash
lsof -nP -iTCP:43179 -sTCP:LISTEN
```

Expected: no output. Remove only fresh Next-generated untracked instruction files if the server created them; do not touch tracked or pre-existing user files.

## Task 2: Characterize the existing `useResolvedPx` client contract

**Files:**

- Modify: `packages/react/src/__tests__/density.test.ts`

- [ ] **Step 1: Import the panel-height hook and Vitest spies**

Change the imports to include `cleanup`, `vi`, and `useResolvedPx`:

```ts
import { afterEach, describe, expect, test, vi } from "vitest";
import { act, cleanup, renderHook } from "@testing-library/react";

import { useResolvedHeights, useResolvedPx } from "../density";
import { getDensityHeights } from "@pretable/ui";
```

Call `cleanup()` first in the existing `afterEach`, before `vi.restoreAllMocks()`, `vi.unstubAllGlobals()`, and the existing `<html>` attribute resets. This disconnects each hook's live `MutationObserver` before later tests mutate the document.

- [ ] **Step 2: Add client resolution and mutation tests**

Append:

```tsx
describe("useResolvedPx hook", () => {
  test("returns the fallback or active CSS pixel value", () => {
    const fallback = renderHook(() =>
      useResolvedPx("--pretable-group-panel-height", 36),
    );
    expect(fallback.result.current).toBe(36);
    fallback.unmount();

    document.documentElement.style.setProperty(
      "--pretable-group-panel-height",
      "44px",
    );
    const css = renderHook(() =>
      useResolvedPx("--pretable-group-panel-height", 36),
    );
    expect(css.result.current).toBe(44);
  });

  test("re-renders when a watched root attribute changes", async () => {
    document.documentElement.style.setProperty(
      "--pretable-group-panel-height",
      "36px",
    );
    const { result } = renderHook(() =>
      useResolvedPx("--pretable-group-panel-height", 36),
    );

    await act(async () => {
      document.documentElement.style.setProperty(
        "--pretable-group-panel-height",
        "44px",
      );
      document.documentElement.setAttribute("data-density", "spacious");
      await Promise.resolve();
    });

    expect(result.current).toBe(44);
  });

  test("disabled mode avoids style reads and DOM subscriptions", () => {
    const getComputedStyleSpy = vi.spyOn(globalThis, "getComputedStyle");
    const mutationObserverSpy = vi.spyOn(globalThis, "MutationObserver");

    const { result } = renderHook(() =>
      useResolvedPx("--pretable-group-panel-height", 36, false),
    );

    expect(result.current).toBe(36);
    expect(getComputedStyleSpy).not.toHaveBeenCalled();
    expect(mutationObserverSpy).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 3: Run the client density tests**

Run:

```bash
pnpm --filter @pretable/react test density.test.ts
```

Expected: PASS on the existing implementation. If a spy observes unrelated test-harness work, narrow it around `renderHook`; do not weaken the disabled-path assertions.

## Task 3: Implement deterministic server snapshots and prove GREEN

**Files:**

- Modify: `packages/react/src/density.ts`
- Test: `packages/react/src/__tests__/density-hydration.test.tsx`
- Test: `packages/react/src/__tests__/density.test.ts`
- Test: `apps/website/e2e/grouping.spec.ts`

- [ ] **Step 1: Add React-internal deterministic fallback constants**

Near the imports in `packages/react/src/density.ts`, add:

```ts
const FALLBACK_ROW_HEIGHT = 32;
const FALLBACK_HEADER_HEIGHT = 36;
```

These intentionally match `@pretable/ui`'s documented private fallbacks without widening its public API.

- [ ] **Step 2: Stop the heights server snapshot from reading the DOM**

Replace the body of `useResolvedHeights`'s `getServerSnapshot` with:

```ts
const getServerSnapshot = useCallback(() => {
  const rowHeight = rowHeightProp ?? FALLBACK_ROW_HEIGHT;
  const headerHeight = headerHeightProp ?? FALLBACK_HEADER_HEIGHT;
  const prev = cachedServer.current;
  if (
    prev !== null &&
    prev.rowHeight === rowHeight &&
    prev.headerHeight === headerHeight
  ) {
    return prev;
  }
  const next = { rowHeight, headerHeight };
  cachedServer.current = next;
  return next;
}, [rowHeightProp, headerHeightProp]);
```

- [ ] **Step 3: Give `useResolvedPx` a deterministic server getter**

Add:

```ts
const getServerSnapshot = useCallback(() => fallback, [fallback]);
```

Pass it as `useSyncExternalStore`'s third argument instead of `getSnapshot`:

```ts
return useSyncExternalStore(
  enabled ? subscribe : noopSubscribe,
  getSnapshot,
  getServerSnapshot,
);
```

- [ ] **Step 4: Run the focused React tests**

Run:

```bash
pnpm --filter @pretable/react test density.test.ts density-hydration.test.tsx
```

Expected: all focused tests PASS; both hydration tests report zero recoverable errors and still finish on the active CSS values.

- [ ] **Step 5: Re-run the real-browser regression against the fixed build**

Repeat Task 1 Steps 6–8, rebuilding dependencies through the website's `predev` hook.

Run the exact focused Chromium command from Task 1 Step 7.

Expected: PASS with Material geometry `52/44`, 13 rendered rows, and no captured hydration error. Stop the exact server and verify port 43179 is closed.

- [ ] **Step 6: Commit the root-cause fix and regressions**

Review `git diff` and stage only:

```bash
git add packages/react/src/density.ts packages/react/src/__tests__/density.test.ts packages/react/src/__tests__/density-hydration.test.tsx apps/website/e2e/grouping.spec.ts
git diff --cached --check
git commit -m "fix(react): hydrate density deterministically"
```

## Task 4: Correct documentation and add release intent

**Files:**

- Modify: `apps/website/content/docs/grid/density-helpers.mdx`
- Create: `.changeset/honest-density-hydration.md`

- [ ] **Step 1: Correct the documented header fallback**

Change the fallback table from `52` to `36` and replace the legacy-header explanation with:

```md
The fallbacks match `@pretable/ui`'s density snapshot contract. They provide deterministic geometry when CSS cannot be read, including server rendering and the browser's hydration pass.
```

- [ ] **Step 2: Clarify the hydration transition**

Replace the SSR-safety paragraph with:

```md
The hook is SSR-safe. Server rendering and the browser's hydration pass both use explicit prop overrides or the deterministic fallbacks, so React receives matching geometry. Immediately after hydration, the client snapshot adopts CSS-resolved values; later theme or density changes are observed through `MutationObserver`.
```

- [ ] **Step 3: Add the React patch changeset**

Create `.changeset/honest-density-hydration.md`:

```md
---
"@pretable/react": patch
---

Prevent populated server-rendered grids from triggering React hydration recovery when CSS theme heights differ from package fallbacks.
```

- [ ] **Step 4: Verify release expansion and formatting**

Run:

```bash
pnpm exec changeset status
pnpm exec prettier --check apps/website/content/docs/grid/density-helpers.mdx .changeset/honest-density-hydration.md
git diff --check
```

Expected: Changesets schedules the public fixed group (`@pretable/core`, `@pretable/react`, `@pretable/stream-adapter`, and `@pretable/ui`) at patch level, with private dependent apps possibly listed by the existing workspace policy. No unrelated public package is included.

- [ ] **Step 5: Commit documentation and release intent**

```bash
git add apps/website/content/docs/grid/density-helpers.mdx .changeset/honest-density-hydration.md
git diff --cached --check
git commit -m "docs: clarify density hydration contract"
```

## Task 5: Full verification and independent review

**Files:**

- Verify all changed files from Tasks 1–4.

- [ ] **Step 1: Run the full React package gate**

Run each command separately and require exit code 0:

```bash
pnpm --filter @pretable/react test
pnpm --filter @pretable/react typecheck
pnpm --filter @pretable/react build
pnpm --filter @pretable/react api:check
pnpm --filter @pretable/react lint
```

Record exact test counts and any warnings. Do not describe warnings as new without checking their source and baseline.

- [ ] **Step 2: Run website static checks**

```bash
pnpm --filter @pretable/app-website typecheck
pnpm --filter @pretable/app-website lint
pnpm exec eslint apps/website/e2e/grouping.spec.ts
```

- [ ] **Step 3: Run the complete grouping browser matrix locally**

Start the tracked local server on the checked-free port 43179 and wait for HTTP 200. Then run:

```bash
BASE_URL=http://localhost:43179 pnpm --filter @pretable/app-website smoke grouping.spec.ts --project=chromium
BASE_URL=http://localhost:43179 pnpm --filter @pretable/app-website smoke grouping.spec.ts --project=webkit
```

Expected: the entire grouping spec passes in both engines, not only the new hydration test. Stop the exact server, verify the port is closed, and remove only fresh generated artifacts.

- [ ] **Step 4: Run repository hygiene checks**

```bash
pnpm exec changeset status
pnpm format
git diff --check
git status --short
```

Expected: all checks exit 0 and the status contains only intentional committed changes (normally empty after Tasks 3 and 4).

- [ ] **Step 5: Perform the required negative control**

Temporarily restore the two old DOM-dependent server getters without committing them. Re-run:

```bash
pnpm --filter @pretable/react test density-hydration.test.tsx
```

Expected: both hydration regressions fail at `recoverableErrors`. Restore the fixed implementation with `apply_patch`, rerun the same command, and require PASS. Never use `git checkout --` or another command that could discard user work.

- [ ] **Step 6: Request independent code review**

Ask a fresh reviewer to compare the final branch against `origin/main`, the approved design, and this plan. Require findings grouped as Critical, Important, and Minor, with explicit attention to:

- the `useSyncExternalStore` hydration contract;
- explicit prop precedence and disabled fast paths;
- whether the browser listener can miss or falsely report hydration errors;
- test cleanup and global restoration;
- release/documentation scope.

Address actionable findings with focused regressions and separate commits, then rerun the affected and full gates.

- [ ] **Step 7: Final evidence check**

Re-read the design acceptance criteria, inspect `git log origin/main..HEAD`, and run fresh final commands proving every completion claim. Confirm there are no running dev servers, open browser sessions, generated artifacts, or uncommitted files before handing off.
