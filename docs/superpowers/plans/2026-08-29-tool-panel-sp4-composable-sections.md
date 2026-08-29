# Tool Panel SP4 — Composable Sections Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Consumer-supplied tool-panel sections per `docs/superpowers/specs/2026-08-29-tool-panel-sp4-composable-sections.md` — a public descriptor type and a full-roster `sections` config that selects, orders, and interleaves built-in and custom sections.

**Architecture:** A pure roster resolver (`tool-panel/roster.ts`) parses and validates the config; the shell's id types widen from the closed union to `string` (behavior unchanged — it already treats ids as data); the surface converts public descriptors to internal ones inside the existing `toolPanelSections` memo. No engine changes.

**Tech Stack:** React 19, TypeScript, vitest (react package script supplies `--environment jsdom`; NEVER bare `vitest run`; positional filters, not `--`), Playwright, api-extractor, changesets.

**Read first, every task:** the spec (all 7 decisions); `packages/react/src/tool-panel/sections.ts` (the contract and its "nothing may assume a closed union at runtime" rule); `ToolPanel.tsx` + `Rail.tsx`; the descriptor memo + DEPS RULE comment in `pretable-surface.tsx` (~3690-3900 — grep `toolPanelSections`); `PretableToolPanelConfig` (~grep it).

**House rules:** worktree only, no `git stash`, no branch checkouts of other branches; commit per task with trailer `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`; `pnpm format` before every commit (required CI gate); loaded box — re-run failures in isolation before believing them; `pnpm build` before `pnpm api`.

---

### Task 1: the roster resolver (pure) + public types

**Files:**
- Create: `packages/react/src/tool-panel/roster.ts`
- Modify: `packages/react/src/tool-panel/sections.ts` (public types + internal id widening)
- Test: `packages/react/src/__tests__/tool-panel-roster.test.ts` (new, pure — no DOM)

- [ ] **Step 1: Widen the internal contract.** In `sections.ts`: `ToolPanelSectionDescriptor.id` becomes `string` (update the comment — the closed-union assumption was never allowed; now the type says so). `ToolPanelSectionId` stays exactly `"columns" | "filters" | "grouping"`. Add the two public types (adapt TSDoc to the file's register; cite the spec):

```ts
/** A consumer-supplied tool-panel section. @public */
export interface PretableToolPanelSection {
  /** Non-empty, no whitespace — interpolated into DOM ids. */
  readonly id: string;
  readonly icon: ComponentType<{ className?: string }>;
  /** Plain string: a custom section is consumer-owned UI; the consumer
   * localizes it where they localize their app. The messages layer stays
   * the built-ins'. */
  readonly label: string;
  readonly render: () => ReactNode;
}

/** A section id nameable in the tool panel's active-section fields:
 * a built-in literal (autocompleted) or any custom id. @public */
export type PretableToolPanelSectionId = ToolPanelSectionId | (string & {});
```

- [ ] **Step 2: Write the failing roster tests.** In the new test file (no React imports):

```ts
import {
  resolveToolPanelRoster,
  type ToolPanelRosterEntry,
} from "../tool-panel/roster";

const builtin = (id: string) => ({
  id,
  icon: (() => null) as never,
  label: id,
  render: () => null,
});
const BUILTINS = [builtin("columns"), builtin("filters"), builtin("grouping")];
const custom = (id: string) => ({ ...builtin(id) });

test("absent roster resolves to the built-ins in shipped order", () => {
  expect(resolveToolPanelRoster(undefined, BUILTINS)).toBe(BUILTINS);
});

test("the roster is the COMPLETE rail: subset, reorder, interleave", () => {
  const mine = custom("mine");
  const out = resolveToolPanelRoster(["grouping", mine, "columns"], BUILTINS);
  expect(out.map((s) => s.id)).toEqual(["grouping", "mine", "columns"]);
  expect(out[1]).toBe(mine); // descriptor passed through, not copied
  expect(out[0]).toBe(BUILTINS[2]); // built-in resolved to the real descriptor
});

test("an empty roster is legal and empty", () => {
  expect(resolveToolPanelRoster([], BUILTINS)).toEqual([]);
});

test.each([
  [["columns", custom("columns")], /duplicate.*"columns"/i],
  [[custom("a"), custom("a")], /duplicate.*"a"/i],
  [[custom("")], /empty/i],
  [[custom("has space")], /whitespace.*"has space"/i],
])("invalid roster throws with the offending id named", (entries, message) => {
  expect(() => resolveToolPanelRoster(entries as never, BUILTINS)).toThrow(
    message,
  );
});

test("a duplicate built-in reference throws too", () => {
  expect(() =>
    resolveToolPanelRoster(["columns", "columns"], BUILTINS),
  ).toThrow(/duplicate/i);
});
```

Also pin the replacement-refusal message: reusing a built-in id on a CUSTOM descriptor throws a message that says replacement is not supported (spec decision 4) — assert a distinctive fragment (e.g. `/replac/i`).

- [ ] **Step 3: Run, confirm all fail** (`pnpm --filter @pretable/react test tool-panel-roster` — module doesn't exist yet).

- [ ] **Step 4: Implement `roster.ts`** (pure; no React value imports):

```ts
import type {
  PretableToolPanelSection,
  ToolPanelSectionDescriptor,
  ToolPanelSectionId,
} from "./sections";

/** One roster entry: a built-in by id, or a custom section. @public via
 * PretableToolPanelConfig — the array element type is API even though this
 * alias may stay internal; check what api-extractor wants named. */
export type ToolPanelRosterEntry = ToolPanelSectionId | PretableToolPanelSection;

/**
 * Resolve the `toolPanel.sections` roster to the descriptor array the shell
 * renders. Absent → the built-ins, AS THE SAME ARRAY (identity matters: the
 * descriptor memo's stability pin watches it). Present → the complete rail
 * in the roster's order.
 *
 * Validation THROWS (spec decision 4): duplicate ids, an empty id, and
 * whitespace ids are programming errors present from the first render —
 * unlike data-dependent faults they cannot lurk, and a warn-and-drop would
 * make a silently missing tab the harder bug.
 */
export function resolveToolPanelRoster(
  entries: readonly ToolPanelRosterEntry[] | undefined,
  builtins: readonly ToolPanelSectionDescriptor[],
): readonly ToolPanelSectionDescriptor[] {
  if (entries === undefined) return builtins;
  const seen = new Set<string>();
  const builtinById = new Map(builtins.map((s) => [s.id, s]));
  return entries.map((entry) => {
    const isReference = typeof entry === "string";
    const resolved = isReference ? builtinById.get(entry) : entry;
    if (isReference && resolved === undefined)
      throw new Error(
        `toolPanel.sections: "${entry}" is not a built-in section id.`,
      );
    const id = (resolved as { id: string }).id;
    if (id.length === 0)
      throw new Error("toolPanel.sections: a section id may not be empty.");
    if (/\s/.test(id))
      throw new Error(
        `toolPanel.sections: section id "${id}" contains whitespace, which DOM ids forbid.`,
      );
    if (!isReference && builtinById.has(id))
      throw new Error(
        `toolPanel.sections: "${id}" is a built-in section id; replacing a built-in is not supported — reference it as the string "${id}" or pick another id.`,
      );
    if (seen.has(id))
      throw new Error(`toolPanel.sections: duplicate section id "${id}".`);
    seen.add(id);
    return resolved as ToolPanelSectionDescriptor;
  });
}
```

Adjust to satisfy lint/exactOptionalPropertyTypes as the repo demands; the CUSTOM branch needs `PretableToolPanelSection` → `ToolPanelSectionDescriptor` conversion — with the widened internal id they are structurally compatible; if a cast is needed, contain and comment it.

- [ ] **Step 5: Run — green.** Mutation-check: make `seen.add` never run → duplicate tests fail; make the resolver `.reverse()` the output → the ordering test fails. Revert both, re-run green.

- [ ] **Step 6: Widen the shell's id types** — `ToolPanel.tsx` (`activeSection: string | null`, `tabId: (id: string)`, `onActiveSectionChange: (next: string | null) => void`), `Rail.tsx`, `focus.ts` where typed. Type-only; run `pnpm --filter @pretable/react test tool-panel` — the existing suites must stay green untouched.

- [ ] **Step 7: Format, lint, typecheck, commit** — `feat(react): tool-panel roster resolver and public section types (SP4)`.

---

### Task 2: surface wiring — config, memo, exports

**Files:**
- Modify: `packages/react/src/pretable-surface.tsx` (config + memo + `<ToolPanel>` render site), `packages/react/src/index.ts` (export the new public types; check how sections.ts types are currently re-exported)
- Test: `packages/react/src/__tests__/tool-panel-composable.test.tsx` (new)

- [ ] **Step 1: Failing jsdom tests** (harness: copy `tool-panel.test.tsx`'s mount pattern; assert on `data-pretable-tool-tab` / `data-pretable-section` attributes):
  1. `toolPanel={{ sections: ["grouping", customSection, "columns"] }}` renders exactly three tabs in that order, the custom one carrying `data-pretable-section="my-section"`; activating it renders the custom `render()` output inside `[data-pretable-tool-section]`.
  2. Hiding a built-in (`sections: ["columns", "filters"]`) removes the grouping tab; the other two still function (positive twin: open columns, see the section).
  3. `defaultActiveSection: "my-section"` opens the custom pane on mount; controlled `activeSection` with a custom id works and reports through `onActiveSectionChange` (typed as `PretableToolPanelSectionId | null`).
  4. Unknown active id → rail renders, no pane, no throw (spec decision 5).
  5. `sections: []` → no rail in the DOM (`[data-pretable-tool-rail]` absent), no pane.
  6. `sections` absent → the three built-in tabs exactly (assert-the-old-behavior at roster level: ids `["columns","filters","grouping"]`).
  7. A colliding roster throws the resolver's error out of render (assert with an error boundary or `expect(() => render(...)).toThrow` per the repo's pattern for render-time throws — check how existing tests assert render throws).
- [ ] **Step 2: Run, confirm all fail.**
- [ ] **Step 3: Implement.** In `pretable-surface.tsx`:
  - `PretableToolPanelConfig` gains `readonly sections?: readonly (ToolPanelSectionId | PretableToolPanelSection)[];` and the three active-section fields widen to `PretableToolPanelSectionId | null` (TSDoc updated; note the inline-roster cost with the `processing` paragraph's framing).
  - The `useState<ToolPanelSectionId | null>` for uncontrolled active section (~line 2077) widens to `string | null`.
  - The descriptor memo: the existing three descriptors become `builtinToolPanelSections` (same memo, same deps, same DEPS RULE comment); a new `toolPanelSections` memo applies `resolveToolPanelRoster(toolPanelConfig?.sections, builtinToolPanelSections)` with deps `[toolPanelConfig?.sections, builtinToolPanelSections]`. Extend the DEPS RULE comment: the roster is a consumer prop (the `processing`/`model` paragraph grows one more citizen). The custom descriptors pass through by reference — `render` is the consumer's own closure; the freshness rule does not apply to consumer state (say so in one line).
  - The `<ToolPanel>` render site: skip rendering entirely when the resolved roster is empty (spec: `sections: []` ≡ panel off — find where `toolPanel === false` already short-circuits and reuse that path's shape).
  - `index.ts`: export `PretableToolPanelSection`, `PretableToolPanelSectionId` (and `ToolPanelRosterEntry` only if api-extractor demands a name for the array element — prefer inlining the union in the config field to keep the surface minimal).
- [ ] **Step 4: Run new file + `tool-panel tool-panel-descriptor-stability` — all green.** The SP3b stability test must pass UNCHANGED. Add the stability sibling to the stability file: with a stable custom roster prop, engine-only changes keep the sections array identity (and a rebuilt inline roster changes it — both directions, mirroring the file's existing pattern).
- [ ] **Step 5: Mutation-check:** make the memo ignore `toolPanelConfig?.sections` (always builtins) → tests 1/2/5 fail. Revert.
- [ ] **Step 6: Full react suite, format, lint, typecheck, commit** — `feat(react): consumer-composable tool-panel sections (SP4)`.

---

### Task 3: e2e — a custom section through the real shell

**Files:**
- Modify: `apps/website/app/fixtures/grouping/page.tsx` OR create a small `apps/website/app/fixtures/tool-panel-sections/page.tsx` (prefer a NEW fixture page — the grouping fixture's header comment now pins exact-text dependencies; do not disturb it). The fixture registers one custom section (simple content: a heading, two buttons, a text input — enough for a tab walk) via `toolPanel={{ sections: ["columns", CUSTOM, "filters", "grouping"] }}`.
- Modify: `apps/website/e2e/tool-panel.spec.ts` (new describe block)

- [ ] **Step 1: New e2e cases** (hydration-gated via the existing helpers; reuse `reachRail`):
  1. The rail shows four tabs in fixture order; the custom tab's `data-pretable-section` equals the fixture id.
  2. Keyboard: one rail stop in, arrows reach the custom tab (position pinned with the "update when a section is added" comment style), Enter opens the custom pane, Tab walks its three controls in DOM order, forward-Tab from the last EXITS the panel (bounded walk, roster-pinned, per the grouping walk's pattern).
  3. Escape from inside the custom pane returns focus to its rail tab (the shell courtesy, now proven for consumer content).
- [ ] **Step 2: Run** per the recipe: root `pnpm build`, `pnpm --filter website build`, prod server on a unique free port, `BASE_URL=... pnpm exec playwright test tool-panel.spec.ts grid-tab-wrap-rows.spec.ts --workers=1` from apps/website — twice, both green (`grid-tab-wrap-rows` guards the rail stop; it must not regress). Next's "destination stream closed early" log noise is ignorable.
- [ ] **Step 3: Format, lint, website typecheck, commit** — `test(e2e): a consumer section rides the tool-panel shell (SP4)`.

---

### Task 4: docs, api, changeset, final verification

**Files:**
- Modify: `apps/website/content/docs/grid/tool-panel.mdx` (a "Custom sections" section: the roster primitive with a code sample showing subset/reorder/interleave; the descriptor fields; the two conduct rules — Tab-reachable controls, NO focus trap, stated as loudly as the page's register allows; the `onGridReady` route to the grid handle with a snippet; the inline-roster cost note; the collision error's meaning incl. replacement-not-supported; `sections: []` ≡ off; hydration note extension). Live example: `apps/website/content/examples/tool-panel-custom-section/` following the tool-panel-grouping example's file conventions — a small custom pane (e.g. a "density" or "notes" section) demonstrating `onGridReady`.
- Modify: `packages/react/src/messages.ts` — none expected (custom labels are plain strings); verify and state so in the docs.
- Create: changeset `@pretable/react` minor.

- [ ] **Step 1:** Write the docs + example; run the website guard suite (`pnpm --filter @pretable/app-website test`) and satisfy every fail-closed demand honestly (the new public types will trip the api-surface guards until prose/tables register them; the message-key guard from #512 should be UNAFFECTED — no new keys — verify). Keep the page's SEO `description` ≤155 chars if touched.
- [ ] **Step 2:** `pnpm build` then `pnpm api`; commit regenerated `.api.md`; `pnpm api:check` green.
- [ ] **Step 3:** Full verification: root build; react + ui + website suites; root lint + typecheck; `pnpm format`. Loaded box: isolate failures before believing.
- [ ] **Step 4: Commit** — docs + plumbing. Push branch, open PR `feat: consumer-composable tool-panel sections (SP4)` (body: spec decisions summary + test plan; standard generated-with footer). Merge on green only; read the merge back from `origin/main` before recording it anywhere.

---

## Self-review notes

- Spec decisions 1-7 map to: Task 1 (2, 4), Task 2 (1, 3, 5, 7), Task 3 (6), Task 4 (6 docs + out-of-scope statements). `sections: []` behavior: Tasks 1 (resolver), 2 (render skip + test 5).
- Type names used consistently: `PretableToolPanelSection`, `PretableToolPanelSectionId`, `resolveToolPanelRoster`, `ToolPanelRosterEntry` (Task 1 defines; Tasks 2-4 consume).
- No engine changes anywhere; grid-core/row-model untouched — if a task finds itself editing them, stop and escalate.
