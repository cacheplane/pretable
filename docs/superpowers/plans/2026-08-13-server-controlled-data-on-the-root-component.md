# Server-Controlled Data On The Root Component — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `<Pretable>` — the component the docs teach as the entry point — able to express server-controlled data, which today is reachable only from `<PretableSurface>`.

**Architecture:** One modifier change widens `PretableControlledQueryOptions`' uncontrolled arm from `onQueryChange?: never` (forbids notification) to `onQueryChange?: (…) => void` (permits it), then the type is renamed to `PretableQueryOptions`. `PretableProps` gains four props — `processing`, `resultMeta`, `dataState`, `onQueryChange` — forwarded verbatim to `PretableSurface`. No new behavior and no new honesty logic: every downgrade rule already lives in `data-scope.ts` behind the surface, and `<Pretable>` inherits it.

**Tech Stack:** TypeScript, React, vitest (`expectTypeOf` + `@ts-expect-error`), `@testing-library/react`, API Extractor.

**Spec:** `docs/superpowers/specs/2026-08-13-server-controlled-data-on-the-root-component-design.md`

---

## File structure

| File | Responsibility | Change |
| --- | --- | --- |
| `packages/react/src/use-pretable.ts` | Owns the query-options union (line 92), consumed at lines 132 and 144 | Widen arm 2; rename the type |
| `packages/react/src/public_api.ts` | Public export list (line 66) | Rename the export |
| `packages/react/src/pretable.tsx` | `PretableProps` (line 11) and the `Pretable` component (line 101) | Add four props; forward them |
| `packages/react/src/__tests__/query-options-types.test.ts` | Type-level proof that all four call shapes resolve correctly | **Create** |
| `packages/react/src/__tests__/pretable.test.tsx` | Behavioral tests for `<Pretable>` | Append three tests |
| `packages/react/react.api.md` | Generated API report (required CI gate) | Regenerate |

**Critical ordering trap:** run `pnpm build` before `pnpm api`. A stale `dist/` silently strips exports from the report and `api:check` does not catch it.

---

### Task 1: Prove the union currently forbids notify-only

**Files:**
- Test: `packages/react/src/__tests__/query-options-types.test.ts` (create)

- [ ] **Step 1: Write the failing type test**

Create `packages/react/src/__tests__/query-options-types.test.ts`:

```ts
import { describe, expectTypeOf, it } from "vitest";

import type { PretableControlledQueryOptions } from "../use-pretable";

// A minimal column tuple: the union is generic over it, and these tests are
// about the query/onQueryChange pairing rather than about column inference.
const columns = [
  { id: "name", accessor: (row: { id: string; name: string }) => row.name },
] as const;

type Columns = typeof columns;
type Options = PretableControlledQueryOptions<Columns>;

describe("query options", () => {
  it("accepts the controlled pair", () => {
    const controlled = {
      query: { filters: [], sort: [], rowGroups: [] },
      onQueryChange: () => {},
    } as const;
    expectTypeOf(controlled).toMatchTypeOf<Options>();
  });

  it("accepts neither", () => {
    expectTypeOf({} as const).toMatchTypeOf<Options>();
  });

  it("accepts notification without control", () => {
    // THE FEATURE. Fails today: the uncontrolled arm says
    // `onQueryChange?: never`, which forbids this.
    const observed = { onQueryChange: () => {} } as const;
    expectTypeOf(observed).toMatchTypeOf<Options>();
  });

  it("still rejects a query with no setter", () => {
    // @ts-expect-error -- `query` requires `onQueryChange`, as `value`
    // requires `onChange`. If this ever stops erroring, the
    // controlled-component guarantee has been lost.
    const broken: Options = { query: { filters: [], sort: [], rowGroups: [] } };
    void broken;
  });
});
```

- [ ] **Step 2: Run the typecheck to verify it fails**

```bash
cd packages/react && npx tsc --noEmit -p tsconfig.json
```

Expected: FAIL, pointing at the "accepts notification without control" block —
`{ onQueryChange: () => void }` is not assignable, because arm 2 declares
`onQueryChange?: never`.

**Note:** `expectTypeOf` and `@ts-expect-error` are compile-time only. `vitest run` will pass this file even while the types are wrong. The typecheck above is the real gate — do not substitute a test run for it.

- [ ] **Step 3: Commit the failing test**

```bash
git add packages/react/src/__tests__/query-options-types.test.ts
git commit -m "test(react): pin the four query-option call shapes

The notify-only case fails today: the uncontrolled arm forbids
onQueryChange rather than making it optional."
```

---

### Task 2: Widen the uncontrolled arm

**Files:**
- Modify: `packages/react/src/use-pretable.ts:91-99`

- [ ] **Step 1: Change the modifier**

Replace lines 91–99 of `packages/react/src/use-pretable.ts`:

```ts
/** Exact controlled-query pair accepted in rows mode. @public */
export type PretableControlledQueryOptions<TColumns> =
  | {
      readonly query: PretableQueryFor<NoInfer<TColumns>>;
      readonly onQueryChange: (
        query: PretableQueryFor<NoInfer<TColumns>>,
      ) => void;
    }
  | { readonly query?: never; readonly onQueryChange?: never };
```

with:

```ts
/**
 * The query/notification pairing accepted in rows mode. @public
 *
 * Two arms, not three. The uncontrolled arm makes `onQueryChange` OPTIONAL
 * rather than forbidden, which is what lets a caller observe the query
 * without controlling it — the `<input defaultValue onChange>` shape. A
 * third arm for that case would express the same constraint set while
 * degrading TypeScript's error text for a malformed pair.
 *
 * Ownership stays unambiguous: no arm lets the caller set `query` while the
 * engine also owns it.
 */
export type PretableQueryOptions<TColumns> =
  /** Controlled: `query` requires its setter, as `value` requires `onChange`. */
  | {
      readonly query: PretableQueryFor<NoInfer<TColumns>>;
      readonly onQueryChange: (
        query: PretableQueryFor<NoInfer<TColumns>>,
      ) => void;
    }
  /** Uncontrolled: the engine owns the query, and MAY report changes. */
  | {
      readonly query?: never;
      readonly onQueryChange?: (
        query: PretableQueryFor<NoInfer<TColumns>>,
      ) => void;
    };
```

- [ ] **Step 2: Update the two consumers**

In the same file, at line 132 and line 144, replace `PretableControlledQueryOptions<TColumns>` with `PretableQueryOptions<TColumns>`.

- [ ] **Step 3: Update the public export**

In `packages/react/src/public_api.ts:66`, replace `PretableControlledQueryOptions,` with `PretableQueryOptions,`.

- [ ] **Step 4: Update the test's import**

In `packages/react/src/__tests__/query-options-types.test.ts`, replace both references:

```ts
import type { PretableQueryOptions } from "../use-pretable";
```

```ts
type Options = PretableQueryOptions<Columns>;
```

- [ ] **Step 5: Run the typecheck to verify it passes**

```bash
cd packages/react && npx tsc --noEmit -p tsconfig.json
```

Expected: PASS, with no error. If the `@ts-expect-error` block now reports "Unused '@ts-expect-error' directive", the controlled-component guarantee has been broken — stop and fix the union rather than deleting the directive.

- [ ] **Step 6: Run the full react suite**

```bash
pnpm --filter @pretable/react test
```

Expected: PASS. Note the suite intermittently fails one random test under load; re-run once before investigating, and check `uptime` first.

- [ ] **Step 7: Commit**

```bash
git add packages/react/src/use-pretable.ts packages/react/src/public_api.ts packages/react/src/__tests__/query-options-types.test.ts
git commit -m "feat(react)!: let a caller observe the query without controlling it

Widens the uncontrolled arm from \`onQueryChange?: never\` to
\`onQueryChange?: (...) => void\`, and renames
PretableControlledQueryOptions -> PretableQueryOptions since the name no
longer covers what it holds. Pre-1.0: no alias kept."
```

---

### Task 3: Forward the four props through `<Pretable>`

**Files:**
- Modify: `packages/react/src/pretable.tsx` — `PretableProps` (from line 11) and `Pretable` (from line 101)

- [ ] **Step 1: Write the failing behavioral test**

Append to `packages/react/src/__tests__/pretable.test.tsx`:

```tsx
it("reports query changes without the caller controlling the query", async () => {
  const onQueryChange = vi.fn();
  const columns = [
    { id: "name", header: "Name", accessor: (row: Row) => row.name },
  ] as const;

  const view = render(
    <Pretable
      ariaLabel="Observed grid"
      rows={[{ id: "a", name: "Ada" }, { id: "b", name: "Grace" }]}
      columns={columns}
      getRowId={(row) => row.id}
      onQueryChange={onQueryChange}
    />,
  );

  fireEvent.click(view.getByRole("button", { name: /name/i }));

  await waitFor(() => expect(onQueryChange).toHaveBeenCalled());
  const query = onQueryChange.mock.calls.at(-1)?.[0];
  expect(query.sort).toHaveLength(1);
  expect(query.sort[0].columnId).toBe("name");
});
```

Add above it, near the file's other helpers:

```tsx
interface Row {
  readonly id: string;
  readonly name: string;
}
```

- [ ] **Step 2: Run it to verify it fails**

```bash
cd packages/react && npx vitest run --environment jsdom src/__tests__/pretable.test.tsx -t "reports query changes"
```

Expected: FAIL. `onQueryChange` is not a member of `PretableProps`, so it is neither accepted nor forwarded and the mock is never called.

- [ ] **Step 3: Add the four props to `PretableProps`**

In `packages/react/src/pretable.tsx`, inside the `PretableProps` interface, add:

```tsx
  /** Which operations the caller applies rather than the engine. Forwarded
   *  verbatim; every honesty rule lives behind `PretableSurface`. */
  processing?: PretableSurfaceProps<TRow, TRowId, TColumns>["processing"];
  /** Server-supplied result metadata: dataset identity and matching total. */
  resultMeta?: PretableSurfaceProps<TRow, TRowId, TColumns>["resultMeta"];
  /** The data lifecycle phase driving the body-state blocks. */
  dataState?: PretableSurfaceProps<TRow, TRowId, TColumns>["dataState"];
  /** Reports the query the engine now holds. `<Pretable>` never accepts
   *  `query`, so this is always the uncontrolled, observed shape. */
  onQueryChange?: (
    query: PretableQueryFor<PretableSurfaceQueryColumns<TRow>>,
  ) => void;
```

Add to the imports at the top of the file:

```tsx
import type { PretableQueryFor } from "@pretable/core";
import type { PretableSurfaceQueryColumns } from "./surface-types";
```

- [ ] **Step 4: Destructure and forward them**

In the `Pretable` function's destructured parameter list (from line 111), add `processing`, `resultMeta`, `dataState`, `onQueryChange` alongside `onRowChange`. Then in the `<PretableSurface>` call, add:

```tsx
      processing={processing}
      resultMeta={resultMeta}
      dataState={dataState}
      onQueryChange={onQueryChange}
```

- [ ] **Step 5: Run the test to verify it passes**

```bash
cd packages/react && npx vitest run --environment jsdom src/__tests__/pretable.test.tsx -t "reports query changes"
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/react/src/pretable.tsx packages/react/src/__tests__/pretable.test.tsx
git commit -m "feat(react): accept server-controlled data props on <Pretable>

processing, resultMeta, dataState and onQueryChange, forwarded verbatim
to PretableSurface. Completes the rung the ladder was missing:
uncontrolled intent, external data."
```

---

### Task 4: Prove external authority and inherited honesty reach the root component

**Files:**
- Test: `packages/react/src/__tests__/pretable.test.tsx` (append)

- [ ] **Step 1: Write the failing tests**

Append to `packages/react/src/__tests__/pretable.test.tsx`:

```tsx
it("does not reorder locally when sort authority is external", async () => {
  const onQueryChange = vi.fn();
  const columns = [
    { id: "name", header: "Name", accessor: (row: Row) => row.name },
  ] as const;

  const view = render(
    <Pretable
      ariaLabel="External sort grid"
      rows={[{ id: "b", name: "Grace" }, { id: "a", name: "Ada" }]}
      columns={columns}
      getRowId={(row) => row.id}
      processing={{ filter: "external", sort: "external" }}
      onQueryChange={onQueryChange}
    />,
  );

  fireEvent.click(view.getByRole("button", { name: /name/i }));
  await waitFor(() => expect(onQueryChange).toHaveBeenCalled());

  // The server owns the order, so the rows are still in supplied order.
  const rendered = view
    .container.querySelectorAll("[data-pretable-row]");
  expect(rendered[0]?.getAttribute("data-pretable-row-id")).toBe("b");
});

it("publishes the server's population through aria-rowcount", () => {
  const columns = [
    { id: "name", header: "Name", accessor: (row: Row) => row.name },
  ] as const;

  const view = render(
    <Pretable
      ariaLabel="Windowed grid"
      rows={[{ id: "a", name: "Ada" }]}
      columns={columns}
      getRowId={(row) => row.id}
      processing={{ filter: "external", sort: "external" }}
      resultMeta={{ total: { kind: "exact", count: 10_432 } }}
    />,
  );

  // 10,432 records + 1 header row.
  expect(
    view.container.querySelector("[data-pretable-scroll-viewport]"),
  ).toHaveAttribute("aria-rowcount", "10433");
});

it("downgrades rather than lies when the total undercounts the loaded rows", () => {
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  const columns = [
    { id: "name", header: "Name", accessor: (row: Row) => row.name },
  ] as const;

  const view = render(
    <Pretable
      ariaLabel="Contradictory grid"
      rows={[{ id: "a", name: "Ada" }, { id: "b", name: "Grace" }]}
      columns={columns}
      getRowId={(row) => row.id}
      processing={{ filter: "external", sort: "external" }}
      resultMeta={{ total: { kind: "exact", count: 1 } }}
    />,
  );

  // 2 loaded + 1 header — the loaded model, not the impossible population.
  expect(
    view.container.querySelector("[data-pretable-scroll-viewport]"),
  ).toHaveAttribute("aria-rowcount", "3");
  expect(warn).toHaveBeenCalled();
});
```

- [ ] **Step 2: Run them**

```bash
cd packages/react && npx vitest run --environment jsdom src/__tests__/pretable.test.tsx
```

Expected: PASS on all three, given Task 3. If the `aria-rowcount` tests fail, the honesty path is wired to a `PretableSurface`-only prop — stop and report, because the spec's third risk has materialised and the slice grows.

- [ ] **Step 3: Prove the honesty guard can fail**

Temporarily change the third test's `count: 1` to `count: 10`. Re-run.

Expected: FAIL — `aria-rowcount` becomes `11`, not `3`. This proves the assertion discriminates rather than passing on a coincidence. Change it back to `count: 1` and confirm PASS.

- [ ] **Step 4: Commit**

```bash
git add packages/react/src/__tests__/pretable.test.tsx
git commit -m "test(react): external authority and inherited honesty through <Pretable>

Proves the downgrade paths in data-scope.ts are reachable from the root
component, and that the guard reddens when the total changes."
```

---

### Task 5: Regenerate the API report

**Files:**
- Modify: `packages/react/react.api.md` (generated)

- [ ] **Step 1: Build before generating**

```bash
pnpm build
```

Expected: success. This step is not optional — a stale `dist/` silently strips exports from the report, and `api:check` does not detect it.

- [ ] **Step 2: Regenerate**

```bash
pnpm api
```

- [ ] **Step 3: Review the diff by eye**

```bash
git diff packages/react/react.api.md
```

Expected exactly: `PretableControlledQueryOptions` renamed to `PretableQueryOptions`; its second arm's `onQueryChange` changed from `never` to a function type; four new members on `PretableProps`. Anything else — especially a *removed* export — means the build was stale. Rebuild and regenerate rather than committing it.

- [ ] **Step 4: Verify the gate**

```bash
pnpm api:check
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/react/react.api.md
git commit -m "chore(api): regenerate the react report"
```

---

### Task 6: Changeset

**Files:**
- Create: `.changeset/server-controlled-root-component.md`

- [ ] **Step 1: Write it**

```markdown
---
"@pretable/react": minor
---

`<Pretable>` now accepts server-controlled data: `processing`, `resultMeta`, `dataState` and `onQueryChange`, forwarded to `PretableSurface`. Previously these were reachable only from `<PretableSurface>`, so a consumer following the documented entry point had to switch components the moment a server applied their filtering.

The blocker was at the type level rather than in prop forwarding: the query union had no arm for an uncontrolled query *with* change notification, so a component that never exposes `query` could not report that the query had changed. The uncontrolled arm now makes `onQueryChange` optional rather than forbidden. `PretableControlledQueryOptions` is renamed `PretableQueryOptions`, with no alias kept.
```

- [ ] **Step 2: Commit**

```bash
git add .changeset/server-controlled-root-component.md
git commit -m "chore: changeset for server-controlled props on the root component"
```

---

## Self-review

**Spec coverage.** §1 widened arm → Tasks 1–2. §2 four props → Task 3. §3 honesty inherited → Task 4. Testing section: type-level → Task 1; behavioral → Tasks 3–4. Landing notes: API report ordering → Task 5; docs prose guard → **not covered**, because this slice writes no docs page. If one is added, it must name only types in the reports, including the renamed `PretableQueryOptions`.

**Placeholders.** None. Every step carries the code or command it needs.

**Type consistency.** `PretableQueryOptions` is used identically in Tasks 1, 2, 5 and 6. `onQueryChange`'s signature matches between `PretableProps` (Task 3) and the union (Task 2). The `Row` interface is defined once in Task 3 and reused in Task 4.

**Known gap, deliberately left:** Task 3's `onQueryChange` types its query via `PretableSurfaceQueryColumns<TRow>` rather than the `TColumns` tuple. That mirrors what `PretableSurface` does for the non-tuple case, but if column-tuple inference is wanted here, it needs a signature change that belongs in its own slice.
