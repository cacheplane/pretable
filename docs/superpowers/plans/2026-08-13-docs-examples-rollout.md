# Docs Examples Rollout Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task.

**Goal:** Fix four broken code samples in the docs, and add twelve running examples to the pages where behavior — not syntax — is the lesson.

**Architecture:** The `<Example id="…" />` component and its registry shipped in PR #349. This plan only *authors examples* against that existing system. No component or infrastructure changes.

**Tech Stack:** Next.js 16 / RSC, `@pretable/react`, `@pretable/core`, `@pretable/stream-adapter`, Vitest, Playwright.

**Branch:** `blove/docs-examples-rollout` off `f99e0c96`.

---

## The authoring contract (read once, applies to every task)

An example is a folder `apps/website/content/examples/<slug>/`:

```
example.ts     default-exports defineExample({ title, description, files, height? })
demo.tsx       optional; default-exports a props-free component
<sources>      the real files, every one declared in `files`
__tests__/     optional
```

Hard rules, all enforced by `lib/docs/__tests__/examples-registry-guard.test.ts`:

- **Every non-conventional file in the folder must appear in `files`.** No hidden helpers. A mock either gets shown to the reader or lives in `demo.tsx`.
- **`description` must be single-line plain prose** — no newline, no backtick run, no leading list/heading marker.
- **Slug must be lowercase kebab-case starting with a letter** (`/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/`).
- **Every registered example must be referenced** by a docs page or an app component, and every `<Example id>` must resolve.
- **No `[!focus` text may survive** into displayed source. Markers are `// [!focus]` (trailing) and `// [!focus:start]` / `// [!focus:end]` (own-line); block-comment forms work for CSS.

After adding a folder, run `pnpm examples:gen` from `apps/website` and commit the regenerated `lib/docs/examples/registry.generated.ts` and `demos.generated.ts`.

Reference implementation to copy the shape from: `content/examples/grouping-panel/`.

### Non-negotiable constraints

- `viewportHeight` is a **required** prop on `PretableSurface` (`packages/react/src/pretable-surface.tsx:684`). Every demo must pass it.
- `PretableColumn` is generic with a `PretableRow` default that resolves to `object` — **always write `PretableColumn<Row>`**, never bare `PretableColumn`. Bare usage is the bug this plan fixes; do not reintroduce it.
- Pane height is fixed (default 480px, `height` overrides). Design each demo to fit — few rows, narrow columns.
- Prefer the typed column helper `createColumnHelper<Row>()` where the page teaches it.

### Verification for every task

From `apps/website`: `pnpm test` (supplies jsdom — a bare `vitest run` fails), `pnpm typecheck`, `pnpm lint`, `pnpm examples:check`, and prettier on touched files. From the repo root: `pnpm format`.

To see a demo in a browser: `pnpm build` then `pnpm start`, and drive `http://localhost:3000`. Kill a stale server with `lsof -ti:3000 | xargs kill -9` — `pkill` leaves the port held.

---

## Phase 0 — the broken samples

These ship wrong code today and no guard catches them. Phase 0 lands first so the fixes are not blocked behind example authoring.

### Task 0.1: Fix `streaming/parsers.mdx` — undecoded byte stream

**Files:** Modify `apps/website/content/docs/streaming/parsers.mdx`

Four snippets (lines ~17, ~31, ~42, ~56, ~66) pass `res.body` into `parseElementStream` / `parsePartialStream`, both typed `(stream: AsyncIterable<string>)`. `res.body` is a `ReadableStream<Uint8Array>`. The snippets do not typecheck and would hand raw bytes to a JSON parser.

- [ ] **Step 1: Confirm the signatures**

Run: `grep -n "parseElementStream\|parsePartialStream" packages/stream-adapter/stream-adapter.api.md`
Expected: both take `AsyncIterable<string>`.

- [ ] **Step 2: Fix each call site**

`element-streams.mdx`'s "Raw JSON" section already does this correctly — copy its idiom:

```ts
const decoded = res.body!.pipeThrough(new TextDecoderStream());
for await (const row of parseElementStream<Row>(decoded)) {
```

Apply to all occurrences. Keep each snippet's surrounding shape intact.

- [ ] **Step 3: Verify no occurrence remains**

Run: `grep -n "parseElementStream<.*>(res.body)\|parsePartialStream<.*>(res.body)\|parseElementStream(res.body)" apps/website/content/docs/streaming/parsers.mdx`
Expected: no output.

- [ ] **Step 4: Commit**

```bash
git add apps/website/content/docs/streaming/parsers.mdx
git commit -m "fix(docs): decode the byte stream before parsing in streaming/parsers"
```

### Task 0.2: Fix the `viewportHeight` omissions

**Files:** Modify `apps/website/content/docs/grid/sorting.mdx`, `apps/website/content/docs/grid/filtering.mdx`

Both `OrdersGrid` fences omit the required `viewportHeight`.

- [ ] **Step 1: Add the prop to both fences**

Add `viewportHeight={360}` to each `<PretableSurface …>` in those two fences, placed with the other props in the existing order convention.

- [ ] **Step 2: Prove the fences now typecheck**

Copy each fence's body into a scratch file under `apps/website/app/docs/__tests__/zz-scratch-<name>.types.tsx`, run `pnpm exec tsc --noEmit` from `apps/website`, grep the output for `zz-scratch`, confirm no errors, then **delete the scratch files**. Report what you saw. (`app/docs/__tests__/*.types.tsx` is the repo's existing convention for type-testing doc snippets — see `cell-presentations.types.tsx`.)

- [ ] **Step 3: Commit**

```bash
git add apps/website/content/docs/grid/sorting.mdx apps/website/content/docs/grid/filtering.mdx
git commit -m "fix(docs): pass the required viewportHeight in the sorting and filtering fences"
```

---

## Phase 1 — the seven highest-leverage examples

Each task follows the same shape: author the folder, regenerate the registry, reference it from the page, verify. Tasks are ordered so the highest-value lands first; they are independent of each other and can be executed in any order.

### Task 1.1: `first-grid` — getting started

**Slug:** `first-grid` · **Page:** `content/docs/getting-started/index.mdx`

**Why:** The current fence is the first code a prospective user reads and it does **not** compile — `Array<PretableColumn>` without the generic yields `Property 'name' does not exist on type 'object'`. Converting it to a real example fixes it under CI forever and gives the reader their first live proof.

- [ ] **Step 1: Reproduce the existing bug** — copy the current fence into `app/docs/__tests__/zz-scratch-first-grid.types.tsx`, run `pnpm exec tsc --noEmit`, confirm the two `TS2339` errors, delete the scratch file. Report the exact errors.
- [ ] **Step 2: Author the folder** — `example.ts`, `demo.tsx`, `columns.ts`, `data.ts`. Keep the People/Ada/Grace/Linus domain so the page's prose still reads correctly. Use `PretableColumn<Person>` (or the column helper) and pass `viewportHeight`. Five rows.
- [ ] **Step 3:** `pnpm examples:gen`, commit the regenerated registry.
- [ ] **Step 4:** Replace the fence in the `<Step title="Render your first grid">` block with `<Example id="first-grid" />`. Keep the surrounding `<Steps>` structure and the CSS-import step intact.
- [ ] **Step 5:** Full verification. Then `pnpm build && pnpm start` and confirm the grid renders on `/docs/getting-started`.
- [ ] **Step 6: Commit.**

**Note:** `grid/pretable-component.mdx` has a near-identical `People` snippet. Do **not** convert that one — leave it as a fence so the two pages don't echo. Flag if it also fails to typecheck.

### Task 1.2: `streaming-chat-grid` repair — make the preview run the real code

**Slug:** existing `streaming-chat-grid` · **Pages:** `content/docs/streaming/element-streams.mdx` (new), homepage `CodeExample.tsx` (existing)

**Why:** The Code tabs show `ChatGrid` driving `connectElementStream`; the preview runs a hand-rolled `<table>` in `demo.tsx` that shares no import with it. A reader who opens on Code and clicks Preview watches a different, unrelated component. Streaming is the headline differentiator and this is its only proof.

- [ ] **Step 1: Read** `content/examples/streaming-chat-grid/` in full, plus `__tests__/response-events-to-chat-rows.test.ts` — its `events()` helper is the shape you want.
- [ ] **Step 2: Replace the mock.** `ChatGrid` takes `openResponseEvents` as an injected prop precisely so it needn't hit the network. Write a scripted async generator yielding `ChatResponseEvent`-shaped values (`response.created` → deltas → `response.completed`) with a small pace, and have `demo.tsx` render the **real** `<ChatGrid>` with it. Delete `MockChatGrid` entirely.
- [ ] **Step 3: Show the script.** Put the generator in its own file (e.g. `scripted-response.ts`) and add it to `files` — it directly answers "how do I test a Responses stream," a real question for this audience. The guard requires every folder file be declared anyway.
- [ ] **Step 4:** Update `example.ts`'s description if the wording no longer fits. Confirm the existing `__tests__/demo.test.tsx` still passes or update it to test the real component.
- [ ] **Step 5:** Add `<Example id="streaming-chat-grid" />` to `element-streams.mdx`, replacing the sentence that points readers to the homepage.
- [ ] **Step 6:** Verify in a browser that rows now **arrive over time** rather than appearing complete, on both `/docs/streaming/element-streams` and `/`. Report what you observed.
- [ ] **Step 7: Commit.**

### Task 1.3: `async-cell-editing` — editing

**Slug:** `async-cell-editing` · **Page:** `content/docs/grid/editing.mdx`

**Why:** The page renders an ASCII state machine (`checking → editing → validating → saving → cleared`) because static text cannot show a five-phase async lifecycle. `saving` (dimmed, `aria-busy`) and `error` (inline message, editor stays open, retry on Enter) are purely temporal.

- [ ] **Step 1:** Author a grid with one column per typed editor — text, number with `validate`, boolean, enum combobox, date. 4–5 rows.
- [ ] **Step 2:** Give `onRowChange` an artificial delay (~800ms) and a deterministic rejection (e.g. reject a negative number) so the reader can watch a cell sit in `saving` and then either clear or show the inline error. Make the failing input obvious in the demo's caption.
- [ ] **Step 3:** Regenerate, reference from the page. Place it near the lifecycle diagram it illustrates; keep the existing "Worked example" fence unless it becomes redundant — say which you chose and why.
- [ ] **Step 4:** Verify in a browser that a commit visibly pends and that the rejection path shows an inline error. Report what you saw.
- [ ] **Step 5: Commit.**

### Task 1.4: `column-filters` — filtering

**Slug:** `column-filters` · **Page:** `content/docs/grid/filtering.mdx`

**Why:** Highest fence-to-behavior ratio in the docs. The funnel hover-reveal, popover anchoring, "ranges wait for both bounds," and async distinct-value loading for an `enum` column with no `options` have **no** code-level representation — there is nothing to put in a fence.

- [ ] **Step 1:** Author a grid with one column per `type` — text, number, enum (no `options`, so distinct values load async), date, boolean — so all operator families are reachable in one grid.
- [ ] **Step 2:** Keep columns narrow; the pane is 480px and five filterable columns is a lot. Consider `height` if it genuinely needs more.
- [ ] **Step 3:** Regenerate, reference from the page.
- [ ] **Step 4:** Verify in a browser: open a filter menu, confirm operators appear and the enum column loads its distinct values.
- [ ] **Step 5: Commit.**

### Task 1.5: `range-selection` — selection

**Slug:** `range-selection` · **Page:** `content/docs/grid/selection.mdx`

**Why:** The page already contains a section headed "Runnable example" with a complete snippet — it was written wanting to be interactive. Shift-click range extend, Cmd/Ctrl discontiguous ranges, marquee drag, and three-state checkbox derivation are gestures.

- [ ] **Step 1:** Promote the page's existing snippet (~lines 118–159) into a real example: `rowSelectionColumn={{ enabled: true }}`, controlled `selection` + `onSelectionChange`, with a caption echoing the current selection the way `grouping-panel` echoes its grouping.
- [ ] **Step 2:** Regenerate, reference from the page, remove the now-superseded fence.
- [ ] **Step 3:** Verify shift-click and marquee drag work in a browser.
- [ ] **Step 4: Commit.**

### Task 1.6: `cell-presentations` — presentations (SHARED)

**Slug:** `cell-presentations` · **Pages:** `content/docs/grid/cell-presentations.mdx` **and** `content/docs/grid/cell-renderers.mdx`

**Why:** The page argues about pixels — tint plus direction marker, dot-as-peripheral-channel, subordinated second line, contrast ratios. None of that is verifiable by reading JSX. It is also the section's marketing moment: dense, colorblind-safe financial formatting.

- [ ] **Step 1:** Author one positions grid using all four components together — `PretableDelta` on P&L, `PretableStatus` on settlement state, `PretableBadge` on a flag, `PretableEntity` for the symbol/name identity column. 4–6 rows, no interaction needed.
- [ ] **Step 2:** Regenerate. Reference the **same id** from both pages — the component supports this and the guard permits it.
- [ ] **Step 3:** On `cell-renderers.mdx`, replace the hand-rolled `status-badge` className fence in the `render` section with the shared example — that fence is a worse, unstyled version of what `PretableStatus` already does.
- [ ] **Step 4:** Verify both pages render it and that the guard's "every example is referenced" check still passes with two referrers.
- [ ] **Step 5: Commit.**

### Task 1.7: `column-layout` — resize, reorder, pin

**Slug:** `column-layout` · **Page:** `content/docs/grid/column-layout.mdx`

**Why:** The page already has a "Code example" fence, and its pin-drop rule needs a full paragraph of geometry ("two-halves target"). Reorder can silently gain or lose a pin — a rule readers must try to believe.

- [ ] **Step 1:** Promote the existing `ResizableGrid` fence, widened to include one left-pinned and one right-pinned column, with controlled `columnWidths` / `columnOrder` / `columnPinned` and a small readout beneath, mirroring `grouping-panel`.
- [ ] **Step 2:** Regenerate, reference from the page, remove the superseded fence.
- [ ] **Step 3:** Verify drag-resize and drag-reorder work in a browser.
- [ ] **Step 4: Commit.**

---

## Phase 2 — the remaining five

### Task 2.1: `partial-streams` — token-by-token growth

**Slug:** `partial-row-stream` · **Page:** `content/docs/streaming/partial-streams.mdx`

**Why:** This is pretable's most visceral streaming visual — one row's cell growing in place — and it exists **nowhere** today, homepage included. Simpler than the element-stream example: no injected dependency needed.

- [ ] Author a scripted async generator yielding `Partial<Row>` content deltas (`"H"`, `"He"`, `"Hel"`, …) into `connectPartialStream`, rendered through `PretableSurface`. Drive the **real** connector; fake only the source.
- [ ] Cover the `createRow` / `onIssue` branch and the "seed the row first" pattern — both easy to get subtly wrong.
- [ ] Regenerate, reference, verify in a browser that a cell visibly grows. Commit.

### Task 2.2: `paste-geometry` — anchor / tile / clip

**Slug:** `paste-geometry` · **Page:** `content/docs/grid/paste.mdx`

**Why:** The anchor/tile/clip rules are spatial. The `paste` DOM event needs **no** permission, so unlike clipboard this is genuinely demonstrable.

- [ ] Grid plus a small read-only `<textarea>` pre-filled with a 2×2 TSV block. Reader copies it, selects a cell or a range, pastes, and watches single-write vs tile vs clip.
- [ ] Consider building the overflow-row-append recipe (the `onPasteCapture` + `parseTsv` fence) as the real component — it is the page's most easily-misapplied pattern and the best agent-consumption case.
- [ ] Watch the 480px budget: grid + textarea + status line is tight. Place the textarea beside, not above, or set `height`.
- [ ] Regenerate, reference, verify a real paste in a browser. Commit.

### Task 2.3: `dark-mode-toggle` — theming

**Slug:** `dark-mode-toggle` · **Page:** `content/docs/theming/light-dark.mdx`

**Why:** The docs site is light-only, so this is the one place a reader can see dark mode at all. It works because `[data-theme="dark"]` in `pretable.css` is a **bare attribute selector**, not `:root`-scoped — so scoping it to a wrapper `<div>` re-themes only the demo.

- [ ] Button flips `data-theme="dark"` on a wrapper div around a `PretableSurface`. Uses the site's already-imported `pretable.css`; no CSS file needed.
- [ ] **Verify the scoping does not leak** — confirm the nav, sidebar, and rest of the page stay light when toggled. This is the whole risk; report what you observed.
- [ ] State in the example's copy that wrapper-scoping is a docs-site adaptation and real apps toggle `<html>`, so it isn't mistaken for the recommended integration.
- [ ] Regenerate, reference, commit.

### Task 2.4: `keyboard-navigation` — scroll follows focus

**Slug:** `keyboard-navigation` · **Page:** `content/docs/grid/keyboard.mdx`

**Why:** Five sub-rules about when and how much the viewport moves — "minimal scroll, never centered," "clear of pinned chrome," "doesn't fight your own scrolling." No reader will trust that from prose.

- [ ] Grid with enough rows (~100+) to exceed the viewport, plus one left and one right pinned column so pinned-group avoidance is visible.
- [ ] Surface the current focus address as text beneath, so keystrokes correlate with scroll.
- [ ] Regenerate, reference, verify `Cmd+End` lands clear of the header and pinned columns. Commit.

### Task 2.5: `custom-theme` — a complete theme file

**Slug:** `custom-theme` · **Page:** `content/docs/theming/custom-themes.mdx`

**Why:** The page's current blocks say "elided for length" — a reader cannot copy a working theme from it without cross-referencing `token-reference.mdx`. This is the best agent-bundle candidate in the docs.

- [ ] A complete `brand.css` (all tokens plus `[data-theme="dark"]` and density tiers), focus-marked (`/* [!focus] */`) on the handful the page walks through, next to a `demo.tsx` that imports and renders it.
- [ ] **Scoping risk:** the shipped themes write tokens at bare `:root`, which would leak page-wide. Scope `brand.css` to a class or attribute on the demo's wrapper, and say so in the copy. If that proves impossible without misrepresenting real integration, report BLOCKED rather than shipping a leaky demo.
- [ ] Have `override-tokens.mdx` cross-reference this example instead of keeping its own partial "swap the entire palette" snippet.
- [ ] Regenerate, reference, verify no page-wide leakage. Commit.

---

## Explicitly out of scope

Do not add examples to these — the analysis judged fences correct for each:

- All four `api-reference.mdx` pages (grid, headless, streaming) and `theming/token-reference.mdx` (guard-pinned table).
- `grid/pretable-surface.mdx` (config hub; its incomplete snippets are deliberate pseudo-code), `grid/custom-rendering.mdx`, `grid/index.mdx`, `getting-started/concepts.mdx`.
- `headless/index.mdx`, `headless/mutations.mdx`.
- `theming/index.mdx`, `override-tokens.mdx`, `cascade-and-overrides.mdx`, `tailwind-css-in-js.mdx`, `pick-a-theme.mdx`.
- **`grid/clipboard.mdx`** — the interesting artifact lands on the OS clipboard and `clipboard.read()` is permission-gated. Any demo either fakes it or proves nothing.
- **A second `grid/grouping.mdx` example** — multi-level is already reachable by dragging in the shipped one, and the custom-aggregator snippet is algebra, not interaction.
- `grid/number-formatting.mdx`, `grid/density-helpers.mdx`, `grid/sorting.mdx`, `headless/state-model.mdx` — judged worthwhile but below the line for this pass. File as follow-ups.

## Done when

- The four broken samples compile, proven by scratch type-tests.
- Twelve examples are registered, each referenced from at least one page, `pnpm examples:check` current.
- `pnpm test`, `typecheck`, `lint`, `format` clean; `pnpm build` succeeds.
- Every demo has been seen working in a real browser, not just asserted.
