# SSR Density Hydration Design

**Status:** Approved for planning

## Goal

Make Pretable's CSS-resolved density hooks hydrate deterministically. Server HTML and React's hydration render must use identical fallback or explicit-prop geometry, while the first client-only render may adopt the active CSS theme without triggering hydration recovery.

## Confirmed problem

`useResolvedHeights` and `useResolvedPx` use DOM-dependent reads as `useSyncExternalStore` server snapshots. A Node server cannot read CSS and emits fallback values, but React calls the same server snapshot again in the browser during hydration, where `document` and computed CSS exist.

With the Material grouping fixture:

- Node SSR resolves header and group-panel heights to `36px` and `36px`.
- Browser hydration resolves them to `52px` and `44px`.
- A 400px surface therefore changes body height from 328px to 304px.
- Virtualization renders 14 rows on the server and expects 13 during hydration.
- React reports a hydration mismatch and regenerates the grid subtree.

The mismatch reproduces locally and in the deployed grouping fixture. A controlled browser run with the initial CSS values held at the server fallbacks produced no hydration error, isolating the snapshot divergence as the cause.

## Approaches considered

### 1. Deterministic server snapshots, CSS-backed client snapshots — selected

Return only explicit props or package fallbacks from `getServerSnapshot`. Keep computed-style reads in `getSnapshot`. React will use the deterministic snapshot during SSR and hydration, then immediately render the CSS-backed snapshot after hydration.

This follows the existing `useHydrated` pattern and the original implementation of `useResolvedHeights`. It fixes the source of the mismatch without changing the public API, CSS contract, or SSR row content.

### 2. Make server fallbacks match the Material theme

Change fallbacks to Material's current `52px` header and `44px` panel values. This would mask the default website case but remain incorrect for Excel, compact, spacious, custom themes, and explicit token overrides. It would also couple React internals to one theme.

Rejected because the server cannot generally know the browser's computed CSS.

### 3. Defer grid or row rendering until after hydration

Render a placeholder or suppress virtual rows until the browser has mounted. This avoids structural mismatch but discards useful SSR output, worsens first paint and accessibility, and treats the symptom rather than the invalid snapshot contract.

Rejected because Pretable intentionally supports populated SSR output.

## Design

### `useResolvedHeights`

Keep the existing client snapshot and subscription behavior. Replace its server snapshot's `getDensityHeights()` call with deterministic values:

- `rowHeightProp ?? FALLBACK_ROW_HEIGHT`
- `headerHeightProp ?? FALLBACK_HEADER_HEIGHT`

Define React-internal fallback constants matching `@pretable/ui`'s documented `32px` row and `36px` header contract. The UI constants are intentionally private, and widening that package's public API solely for this fix would be unnecessary. Preserve the per-hook server snapshot cache because `useSyncExternalStore` requires stable object identity while values are unchanged.

Explicit props remain authoritative on the server, during hydration, and on the client. Without props, the hook transitions from package fallbacks during hydration to computed CSS values immediately afterward.

### `useResolvedPx`

Keep the existing client getter and subscription behavior. Add a distinct server getter that always returns `fallback` and pass it as the third argument to `useSyncExternalStore`.

When `enabled` is false, both server and client snapshots continue to return the fallback and no DOM subscription is installed.

### Surface behavior

`PretableSurface` remains unchanged. Its viewport calculations will receive deterministic hydration values and then naturally recompute when the hooks expose client CSS values. React will update styles and the virtual row window as a normal post-hydration render rather than recovering from mismatched markup.

No CSS token, component prop, emitted attribute, or public type changes.

## Test design

### Hook-level SSR-to-hydration regression

Add a faithful `renderToString` to `hydrateRoot` test that exercises both hooks together. The React package's test command always installs jsdom, so the test must explicitly stub `document` to `undefined` while calling `renderToString`, restore it, and only then install CSS and hydrate:

1. Produce server markup without DOM-backed CSS values, proving fallback geometry is serialized.
2. Install browser CSS values that differ from the fallbacks.
3. Hydrate the exact server markup and capture `onRecoverableError`.
4. Assert the hydration render agrees with the server markup.
5. Assert the immediate client render transitions to the CSS-backed values.
6. Assert no recoverable hydration error occurs.

The test must fail against the current implementation for the observed mismatch, not because of test setup or an unrelated warning.

Add a second mixed-prop case: provide an explicit row height while leaving header height implicit. Its server and hydration snapshots must preserve the explicit value, while only the implicit value transitions to CSS after hydration. This prevents an implementation that hardcodes every server value from ignoring the existing prop-precedence contract.

### `useResolvedPx` client contract

Add focused client tests for the panel-height helper's existing behavior:

- CSS value and fallback resolution;
- mutation-driven updates;
- `enabled: false` returning the fallback without calling `getComputedStyle` or constructing a `MutationObserver`.

These characterize an otherwise untested internal hook and protect the subscription fast path while its server snapshot is changed.

### Browser structural regression

Use the populated grouping fixture, where the height divergence changes the virtual row window. Register console and `pageerror` listeners before navigation, wait for `data-pretable-hydrated="true"`, and assert:

- no recoverable hydration error;
- no page error or console message indicating a hydration mismatch;
- the post-hydration surface adopts the Material header and group-panel heights and exposes the expected client row window.

Do not add a second full-surface `hydrateRoot` unit test. The hook test directly pins both broken snapshot contracts, while the real-browser check protects the virtualized surface without relying on jsdom layout or trying to observe React's transient hydration pass after `act` has already flushed the intended client update.

Run the check against a locally built development server, not Playwright's default deployed URL: start `pnpm --filter @pretable/app-website dev --hostname localhost --port <free-port>`, then run `BASE_URL=http://localhost:<free-port> pnpm --filter @pretable/app-website smoke grouping.spec.ts --project=chromium` and the equivalent WebKit command. Track and stop that exact server and verify the port closes.

### Existing behavior

Keep current client-only `useResolvedHeights` tests for prop precedence, CSS reads, fallbacks, and mutation-driven updates. Add the missing `useResolvedPx` client contract tests described above. Run the full React suite, React typecheck/build/API checks, website typecheck/lint, formatting, and the focused browser matrix.

## Documentation

Update the density helper documentation to state the actual package fallbacks (`32px` row and `36px` header) and distinguish the deterministic hydration snapshot from the post-hydration CSS-backed snapshot.

## Non-goals

- Inferring a server theme from browser CSS.
- Changing theme token values or fallback policy.
- Hiding populated grids during SSR.
- Refactoring virtualization or surface layout.
- Addressing unrelated grouping or accessibility work.

## Acceptance criteria

- The regression test is observed failing before production changes and passing afterward.
- SSR and hydration use identical deterministic snapshots for both sizing hooks.
- CSS values still take effect immediately after hydration and on later theme or density mutations.
- The populated grouping fixture produces no hydration recovery locally in Chromium and WebKit.
- Existing React and website validation remains green.
- The final diff contains only the root-cause fix, targeted tests, and corrected density documentation.
