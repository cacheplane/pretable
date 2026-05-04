# Website Polish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Four polish passes on the marketing site — fix the invisible drawer handle, make the in-drawer brand link close the drawer, rewrite "Why it works" around the math thesis with an agentic-apps angle, and add a session-aware return path from docs back to the marketing drawer.

**Architecture:** Each task is independent. Drawer handle uses plain CSS in `globals.css` (the Tailwind `bg-drawer-bg` utility doesn't resolve the token here). NavBar gains a click handler in drawer mode and a sessionStorage-driven conditional href in site mode. `useDrawer` writes/clears the flag on open/close. `HowItWorks` gets a copy/structure rewrite — same components, new framing.

**Tech Stack:** Next.js (App Router), React 19, Tailwind v4, Vitest + Testing Library, Playwright. Package manager is pnpm.

**Spec:** [`docs/superpowers/specs/2026-05-04-website-polish-design.md`](../specs/2026-05-04-website-polish-design.md)

---

## File Map

| File | Change |
|------|--------|
| `apps/website/app/globals.css` | Modify — replace `.drawer-handle` rules with iOS-style peek-edge styling |
| `apps/website/app/components/DrawerHandle.tsx` | Modify — remove appearance utilities, keep behavior + grab-bar markup |
| `apps/website/app/components/useDrawer.ts` | Modify — write/clear sessionStorage flag in `open`/`close` |
| `apps/website/app/components/NavBar.tsx` | Modify — drawer-mode brand calls `onClose`; site-mode brand has conditional href |
| `apps/website/app/components/HowItWorks.tsx` | Modify — new heading, new lede, swap DOM/math callout for "Built for agentic apps" |
| `apps/website/__tests__/components/HowItWorks.test.tsx` | Modify — update to new heading + callout copy |
| `apps/website/app/components/__tests__/NavBar.test.tsx` | Modify — assert brand click closes drawer + conditional href in site mode |
| `apps/website/app/components/__tests__/useDrawer.test.ts` | Modify — assert sessionStorage flag writes/clears |
| `apps/website/e2e/smoke.spec.ts` | Modify — add docs→home return-path test |

---

## Task 1: Fix drawer handle visibility (iOS-style peek edge)

**Files:**
- Modify: `apps/website/app/globals.css` (lines 214–225)
- Modify: `apps/website/app/components/DrawerHandle.tsx`

The current `.drawer-handle` button uses `bg-drawer-bg` Tailwind utility which resolves to `rgba(0,0,0,0)` (transparent) — verified in browser. Plain CSS in `globals.css` will own appearance.

- [ ] **Step 1: Replace `.drawer-handle` CSS rules**

In `apps/website/app/globals.css`, replace the existing `html[data-drawer] .drawer-handle` block (currently around line 214–225) with:

```css
html[data-drawer] .drawer-handle {
  position: fixed;
  left: 0;
  right: 0;
  bottom: 0;
  z-index: 51;
  pointer-events: auto;
  /* iOS-style peek edge */
  background: var(--pt-drawer-bg);
  color: var(--pt-drawer-text);
  border-top-left-radius: 14px;
  border-top-right-radius: 14px;
  box-shadow: 0 -8px 24px rgba(0, 0, 0, 0.25);
  padding: 14px 0 16px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
}

html[data-drawer] .drawer-handle::before {
  content: "";
  display: block;
  width: 36px;
  height: 4px;
  border-radius: 2px;
  background: var(--pt-text-dim);
  opacity: 0.5;
}

html[data-drawer="open"] .drawer-handle {
  display: none !important;
}
```

(The `display: none !important` rule for the open state must be preserved — it sits below the closed-state rule.)

- [ ] **Step 2: Trim DrawerHandle.tsx of appearance utilities**

In `apps/website/app/components/DrawerHandle.tsx`, replace the className with one that only carries Tailwind utilities the CSS rule doesn't own (focus ring, font, hover transform):

```tsx
"use client";

import { useDrawer } from "./useDrawer";

export function DrawerHandle() {
  const { open } = useDrawer();
  return (
    <button
      aria-controls="drawer-content"
      aria-expanded="false"
      className="drawer-handle w-full font-mono text-[12px] font-semibold uppercase tracking-[0.14em] transition-transform hover:-translate-y-0.5 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg-page"
      data-testid="drawer-handle"
      onClick={open}
      type="button"
    >
      ↑ Why pretable
    </button>
  );
}
```

(The grab-bar pill is rendered via the CSS `::before` pseudo-element, not markup, so the button stays a single text node — preserves screen-reader behavior.)

- [ ] **Step 3: Visual verification**

Run: `cd apps/website && pnpm dev`
Open http://localhost:3000 in a browser. Expected:
- Bar is visible at the bottom of the viewport against the grid (opaque `#1e293b`, no longer transparent).
- Top corners are rounded (~14px); bottom corners square.
- Small grab-bar pill (~36×4px) sits centered above the "↑ Why pretable" label.
- Subtle shadow lifts the bar off the grid.
- Clicking still opens the drawer.
- When drawer is open, the bar disappears.

- [ ] **Step 4: Run existing tests**

Run: `cd apps/website && pnpm test -- DrawerShell DrawerHandle Nav`
Expected: existing tests still pass (no behavior change to drawer state machine).

- [ ] **Step 5: Commit**

```bash
git add apps/website/app/globals.css apps/website/app/components/DrawerHandle.tsx
git commit -m "fix(website): drawer handle now renders as visible iOS-style peek edge"
```

---

## Task 2: Drawer-mode brand link closes the drawer

**Files:**
- Modify: `apps/website/app/components/NavBar.tsx`
- Modify: `apps/website/app/components/__tests__/NavBar.test.tsx`

When `mode="drawer"` and `onClose` is provided, the brand `<Link>` should call `onClose()` and `preventDefault()` on click — same behavior as the "Show the grid" button. Site-mode brand is unchanged in this task.

- [ ] **Step 1: Write the failing test**

In `apps/website/app/components/__tests__/NavBar.test.tsx`, add inside the `describe("mode='drawer'")` block:

```tsx
import { fireEvent } from "@testing-library/react";
// ... existing imports ...

it("clicking the brand calls onClose and prevents navigation", () => {
  let closed = false;
  const onClose = () => {
    closed = true;
  };
  render(<NavBar mode="drawer" onClose={onClose} />);
  const brand = screen.getByRole("link", { name: /pretable\.ai/i });
  const event = new MouseEvent("click", { bubbles: true, cancelable: true });
  brand.dispatchEvent(event);
  expect(closed).toBe(true);
  expect(event.defaultPrevented).toBe(true);
});
```

(Note: `fireEvent` won't suit here because we need to inspect `defaultPrevented` on the raw event. Use `dispatchEvent`.)

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/website && pnpm test -- NavBar`
Expected: FAIL — brand currently navigates without preventDefault.

- [ ] **Step 3: Implement the click handler in NavBar**

In `apps/website/app/components/NavBar.tsx`, change the brand `<Link>` so that drawer mode adds an onClick that calls `onClose` and prevents default:

```tsx
<Link
  className="flex shrink-0 items-center gap-2 font-mono text-[13px]"
  href="/"
  onClick={
    mode === "drawer" && onClose
      ? (e) => {
          e.preventDefault();
          onClose();
        }
      : undefined
  }
>
  <span aria-hidden="true" className="text-accent">
    ●
  </span>
  <span className="font-semibold text-text-primary">pretable.ai</span>
</Link>
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/website && pnpm test -- NavBar`
Expected: PASS for the new test plus all existing NavBar tests.

- [ ] **Step 5: Manual verification**

Run dev server, open the drawer, click the `pretable.ai` brand. Drawer should close and grid should be visible. URL should remain `/` (not bounce through navigation).

- [ ] **Step 6: Commit**

```bash
git add apps/website/app/components/NavBar.tsx apps/website/app/components/__tests__/NavBar.test.tsx
git commit -m "feat(website): drawer-mode brand link closes the drawer"
```

---

## Task 3: useDrawer writes/clears sessionStorage flag

**Files:**
- Modify: `apps/website/app/components/useDrawer.ts`
- Modify: `apps/website/app/components/__tests__/useDrawer.test.ts`

The flag `pretable:lastDrawer=open` records that the drawer was last seen open on `/`. NavBar (site mode) reads it in Task 4. `open()` writes it; `close()` clears it. The hash-on-mount auto-open path also counts as "open".

- [ ] **Step 1: Write the failing tests**

In `apps/website/app/components/__tests__/useDrawer.test.ts`, add `sessionStorage.clear()` to `afterEach` and add three new tests at the bottom of the `describe` block:

```ts
afterEach(() => {
  history.replaceState({}, "", "/");
  document.documentElement.removeAttribute("data-drawer");
  sessionStorage.clear();
});

// ... existing tests ...

it("open() writes pretable:lastDrawer='open' to sessionStorage", () => {
  const { result } = renderHook(() => useDrawer(), { wrapper });
  act(() => result.current.open());
  expect(sessionStorage.getItem("pretable:lastDrawer")).toBe("open");
});

it("close() clears pretable:lastDrawer from sessionStorage", () => {
  const { result } = renderHook(() => useDrawer(), { wrapper });
  act(() => result.current.open());
  act(() => result.current.close());
  expect(sessionStorage.getItem("pretable:lastDrawer")).toBeNull();
});

it("hash-on-mount auto-open also writes the flag", () => {
  history.replaceState({}, "", "/#receipts");
  renderHook(() => useDrawer(), { wrapper });
  expect(sessionStorage.getItem("pretable:lastDrawer")).toBe("open");
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd apps/website && pnpm test -- useDrawer`
Expected: FAIL — flag is never written.

- [ ] **Step 3: Implement the flag**

In `apps/website/app/components/useDrawer.ts`:

a) Add a constant near the top:

```ts
const LAST_DRAWER_KEY = "pretable:lastDrawer";
```

b) In the existing hash-on-mount effect, after `setIsDrawerOpen(true)`, write the flag:

```ts
const hash = window.location.hash.replace("#", "");
if (hash && DRAWER_SECTIONS.has(hash)) {
  setIsDrawerOpen(true);
  sessionStorage.setItem(LAST_DRAWER_KEY, "open");
}
```

c) In `open`, after `setIsDrawerOpen(true)`:

```ts
const open = useCallback(() => {
  if (typeof window === "undefined") return;
  history.pushState({ drawer: "open" }, "");
  setIsDrawerOpen(true);
  sessionStorage.setItem(LAST_DRAWER_KEY, "open");
}, [setIsDrawerOpen]);
```

d) In `close`, clear the flag (do this before any window-guarded code so it runs in tests):

```ts
const close = useCallback(() => {
  setIsDrawerOpen(false);
  if (typeof window === "undefined") return;
  sessionStorage.removeItem(LAST_DRAWER_KEY);
  // existing hash-stripping logic stays here
  const hash = window.location.hash.replace("#", "");
  if (hash && DRAWER_SECTIONS.has(hash)) {
    history.replaceState(
      history.state,
      "",
      window.location.pathname + window.location.search,
    );
  }
}, [setIsDrawerOpen]);
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd apps/website && pnpm test -- useDrawer`
Expected: PASS for new tests + all existing useDrawer tests.

- [ ] **Step 5: Commit**

```bash
git add apps/website/app/components/useDrawer.ts apps/website/app/components/__tests__/useDrawer.test.ts
git commit -m "feat(website): useDrawer records last-open state in sessionStorage"
```

---

## Task 4: NavBar site-mode brand has conditional href

**Files:**
- Modify: `apps/website/app/components/NavBar.tsx`
- Modify: `apps/website/app/components/__tests__/NavBar.test.tsx`

On non-home pages (`/docs`, `/bench`), if `pretable:lastDrawer=open` is present, the brand href becomes `/#receipts` so the user lands back in the drawer. SSR + cold loads (no flag) get `/`. Hash fragments are equivalent to `/` for SEO.

- [ ] **Step 1: Write the failing test**

In `apps/website/app/components/__tests__/NavBar.test.tsx`, inside the `describe("mode='site'")` block, add:

```tsx
import { useEffect } from "react";
// ... existing imports ...

afterEach(() => {
  sessionStorage.clear();
});

it("brand href is '/' by default", () => {
  render(<NavBar mode="site" />);
  const brand = screen.getByRole("link", { name: /pretable\.ai/i });
  expect(brand.getAttribute("href")).toBe("/");
});

it("brand href becomes '/#receipts' when sessionStorage flag is set", () => {
  sessionStorage.setItem("pretable:lastDrawer", "open");
  render(<NavBar mode="site" />);
  const brand = screen.getByRole("link", { name: /pretable\.ai/i });
  // useEffect runs synchronously after render in Testing Library; the
  // upgraded href is observable on the next tick.
  return Promise.resolve().then(() => {
    expect(brand.getAttribute("href")).toBe("/#receipts");
  });
});
```

Add `afterEach` import to vitest if not already imported.

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd apps/website && pnpm test -- NavBar`
Expected: FAIL — second test fails because brand href is hardcoded to `/`.

- [ ] **Step 3: Implement the conditional href**

In `apps/website/app/components/NavBar.tsx`:

a) The file is already `"use client"`. Add `useEffect, useState` to the React import:

```tsx
"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
```

b) Inside the `NavBar` component, before the return, add:

```tsx
const [brandHref, setBrandHref] = useState("/");

useEffect(() => {
  if (mode !== "site") return;
  if (typeof window === "undefined") return;
  const flag = sessionStorage.getItem("pretable:lastDrawer");
  if (flag === "open") {
    setBrandHref("/#receipts");
  }
}, [mode]);
```

c) Replace the hardcoded `href="/"` on the brand `<Link>` with `href={brandHref}`. The drawer-mode click handler from Task 2 stays — it preventDefaults regardless of href.

```tsx
<Link
  className="flex shrink-0 items-center gap-2 font-mono text-[13px]"
  href={brandHref}
  onClick={
    mode === "drawer" && onClose
      ? (e) => {
          e.preventDefault();
          onClose();
        }
      : undefined
  }
>
  ...
</Link>
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd apps/website && pnpm test -- NavBar`
Expected: PASS for all NavBar tests.

- [ ] **Step 5: Manual verification**

Run dev server. Open `/`, open drawer, navigate to `/docs` (e.g., via top-right `/docs` link). Click `pretable.ai` brand → should land on `/` with the drawer open. Then close the drawer. Reload `/docs`. Click brand → should land on `/` with the drawer closed.

- [ ] **Step 6: Commit**

```bash
git add apps/website/app/components/NavBar.tsx apps/website/app/components/__tests__/NavBar.test.tsx
git commit -m "feat(website): site-mode brand returns to drawer when last-open flag is set"
```

---

## Task 5: Rewrite "Why it works" — math thesis + agentic-apps callout

**Files:**
- Modify: `apps/website/app/components/HowItWorks.tsx`
- Modify: `apps/website/__tests__/components/HowItWorks.test.tsx`

Heading becomes "DOM measuring sucks. We use math. It's hard." The DOM/math callout's content moves into the lede paragraph, freeing its slot for "Built for agentic apps."

- [ ] **Step 1: Update the test for the new heading and callout copy**

In `apps/website/__tests__/components/HowItWorks.test.tsx`:

a) Replace the first test:

```tsx
it("renders the section header (eyebrow + h2)", () => {
  const { container } = render(<HowItWorks />);
  expect(container.textContent ?? "").toMatch(/how it works/i);
  const h2 = container.querySelector("h2");
  expect(h2).toBeInTheDocument();
  expect(h2?.textContent ?? "").toMatch(/dom measuring sucks/i);
  expect(h2?.textContent ?? "").toMatch(/we use math/i);
  expect(h2?.textContent ?? "").toMatch(/it's hard/i);
});
```

b) Replace the callouts test:

```tsx
it("renders four callouts including the agentic-apps callout", () => {
  const { container } = render(<HowItWorks />);
  const calloutHeadings = container.querySelectorAll(
    "[data-testid='howitworks-callouts'] h4",
  );
  expect(calloutHeadings.length).toBe(4);
  const text = container.textContent ?? "";
  expect(text).toMatch(/built for agentic apps/i);
  // The DOM/math claim moved into the lede paragraph.
  expect(text).toMatch(/character-width tables/i);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd apps/website && pnpm test -- HowItWorks`
Expected: FAIL — heading and callouts don't match yet.

- [ ] **Step 3: Update the heading and lede in HowItWorks.tsx**

In `apps/website/app/components/HowItWorks.tsx`, replace the `<h2>` and intro `<p>` (currently around lines 64–73) with:

```tsx
<h2 className="mt-4 font-display text-[36px] leading-[1.05] tracking-[-0.025em] md:text-[44px]">
  DOM measuring sucks. We use math.{" "}
  <em className="italic text-accent">It's hard.</em>
</h2>
<p className="mt-5 max-w-[65ch] font-display text-[15px] leading-[1.6] text-text-secondary">
  Wrapped row heights are computed with character-width tables and font
  metrics — pure arithmetic. No{" "}
  <code className="font-mono text-[13.5px] text-text-primary">
    getBoundingClientRect
  </code>
  , no forced reflow, no measure-on-mount. The DOM is touched exactly
  once per frame, at commit. The five-stage pipeline below is what
  enforces that discipline.
</p>
```

- [ ] **Step 4: Swap the DOM/math callout for the agentic-apps callout**

In the same file, replace the first entry in `CALLOUTS` (the `"DOM is expensive. We use math instead."` callout, currently at the top of the array) with:

```tsx
{
  heading: "Built for agentic apps.",
  body: (
    <>
      LLM streams, partial JSON, tool-call traces — bursts of 100 to
      25,000 patches/sec all collapse to one snapshot per animation
      frame. No per-token reflow. Selection survives every patch.
    </>
  ),
},
```

The other three callouts (`Engine is a pure function.`, `RAF batches the stream.`, `Telemetry stays off-DOM.`) stay unchanged.

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd apps/website && pnpm test -- HowItWorks`
Expected: PASS for all HowItWorks tests.

- [ ] **Step 6: Run the full website test suite**

Run: `cd apps/website && pnpm test`
Expected: PASS — page-level tests that grep for old "deterministic pipeline" copy may also need updating. If `__tests__/page.test.tsx` fails, search for `deterministic pipeline` or `dom is expensive` in it and update to the new copy.

- [ ] **Step 7: Visual verification**

Run dev server, open the drawer, scroll to the "how it works" section. Confirm new heading, new lede paragraph, and the new "Built for agentic apps" callout appears in the 4-pack.

- [ ] **Step 8: Commit**

```bash
git add apps/website/app/components/HowItWorks.tsx apps/website/__tests__/components/HowItWorks.test.tsx
git commit -m "feat(website): why-it-works leads with the math thesis + agentic-apps callout"
```

---

## Task 6: Playwright smoke — docs→home return path

**Files:**
- Modify: `apps/website/e2e/smoke.spec.ts`

End-to-end check that the brand link round-trips drawer state correctly.

- [ ] **Step 1: Add the smoke test**

Read the existing structure of `apps/website/e2e/smoke.spec.ts` first to match its conventions (`test.describe`, fixtures, base URL handling). Then add a new `test()` with this shape:

```ts
test("docs brand link returns to drawer when it was last open", async ({ page }) => {
  await page.goto("/");
  // Open the drawer via the bottom handle.
  await page.getByTestId("drawer-handle").click();
  await expect(page.locator("html[data-drawer='open']")).toBeVisible();

  // Navigate to /docs via the in-drawer /docs link.
  await page.getByRole("link", { name: /\/docs/i }).first().click();
  await expect(page).toHaveURL(/\/docs/);

  // Click brand → should land back on / with drawer open.
  await page.getByRole("link", { name: /pretable\.ai/i }).click();
  await expect(page).toHaveURL(/\/#receipts$/);
  await expect(page.locator("html[data-drawer='open']")).toBeVisible();
});

test("docs brand link goes to bare grid when drawer was never opened", async ({ page }) => {
  await page.goto("/docs");
  await page.getByRole("link", { name: /pretable\.ai/i }).click();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.locator("html[data-drawer='closed']")).toBeVisible();
});
```

If the existing file uses fixtures or helpers that differ from this shape, adapt accordingly — match local conventions.

- [ ] **Step 2: Run the e2e tests**

Run: `cd apps/website && pnpm test:e2e -- smoke`
(If the script name differs, check `apps/website/package.json` for the e2e command.)
Expected: PASS for both new tests.

- [ ] **Step 3: Commit**

```bash
git add apps/website/e2e/smoke.spec.ts
git commit -m "test(website): smoke covers docs→home drawer return path"
```

---

## Final Verification

- [ ] **Run full unit test suite**

Run: `cd apps/website && pnpm test`
Expected: all PASS.

- [ ] **Run typecheck**

Run: `cd apps/website && pnpm typecheck`
Expected: no errors.

- [ ] **Run lint**

Run: `cd apps/website && pnpm lint`
Expected: no errors.

- [ ] **Manual smoke**

Open dev server. Verify:
1. Bottom drawer handle is visible (opaque, rounded, grab bar).
2. Click handle → drawer opens.
3. In drawer, click `pretable.ai` brand → drawer closes (no navigation).
4. Open drawer, scroll to "how it works" — new heading reads "DOM measuring sucks. We use math. *It's hard.*"; agentic-apps callout is in the 4-pack.
5. Open drawer, click `/docs` → on docs page, click `pretable.ai` brand → drawer is open on `/`.
6. From a fresh tab, open `/docs` directly → click brand → drawer is closed on `/`.
