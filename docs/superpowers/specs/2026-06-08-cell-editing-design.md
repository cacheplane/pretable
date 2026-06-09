# Cell editing (v1) — design

**Date:** 2026-06-08
**Status:** Approved (brainstorm)
**Branch:** `claude/cell-editing`

## Goal

Add inline cell editing to pretable — the largest table-stakes gap for a "drop-in
React data grid" (see the v1 gap assessment). v1 ships a **full async edit
lifecycle**: per-cell editability, validation, and commit may each be async, with
explicit pending/error states.

## Data flow — controlled

A commit calls **`onCellEdit({ rowId, columnId, value, row })`**; the app updates
its own `rows` (or, headless, calls `grid.applyTransaction`). The grid never
mutates a private row copy — identical to `onSortChange` / `onSelectionChange` /
`onColumnWidthsChange` today. The edited value flows back down through the `rows`
prop, so there is one source of truth. **No uncontrolled mode in v1.**

Commit is **pessimistic**: while `onCellEdit` is in flight the cell shows a
`saving` state and the draft is retained; the row only changes once the app
persists and feeds new `rows` back down. No optimistic apply in v1.

## Edit lifecycle

One edit moves through phases, each gated by an async-capable hook:

```
idle → [editable()?] → editing → [validate()?] → [onCellEdit()?] → committed
                ↘ denied        ↘ invalid(msg)    ↘ failed(error)
```

`snapshot.editing` carries the phase so React and headless consumers render
identically:

```ts
editing: {
  rowId: string;
  columnId: string;
  draft: unknown;
  status: "checking" | "editing" | "validating" | "saving" | "error";
  error?: string;          // present for "invalid" message (status "editing") and "error"
} | null;
```

Note: an `invalid` validation result returns to `status: "editing"` with `error`
set (the user fixes and re-commits); `error` is the distinct terminal-but-retryable
commit-failure state.

## State in core, orchestration in the surface

`@pretable/core` owns the lifecycle as **synchronous** transitions and exposes
`snapshot.editing`. It never holds a promise — it stays pure and unit-testable.

New `PretableGrid` methods (all sync):

- `beginEdit(addr: PretableCellAddress, opts?: { draft?: unknown; status?: "checking" | "editing" }): void`
  — create the editing record. Default `status: "editing"`; the orchestrator
  passes `"checking"` when an async `editable` gate must resolve first.
- `setEditDraft(value: unknown): void`
- `markEditing(): void` — transition `checking` → `editing` (after `editable`
  resolves `true`).
- `markEditValidating(): void` / `markEditSaving(): void` — phase transitions for
  the validate / commit async gates.
- `markEditInvalid(message: string): void` — back to `editing` with `error` set.
- `markEditError(message: string): void` — enter `error`.
- `commitEditSucceeded(): void` — clear editing (success).
- `cancelEdit(): void` — clear editing (revert / deny).

`snapshot.editing.status` reflects the current phase. A synchronous
`editable: true` skips `checking` entirely (`beginEdit` with default
`status: "editing"`); the orchestrator only uses `checking` when `editable`
returns a promise.

The **React surface (and any headless consumer) drives the async**:

```
trigger →
  editable sync true   → beginEdit(addr, { draft }) [status "editing"]
  editable async       → beginEdit(addr, { draft, status: "checking" })
                         → await editable(input)
                             false → cancelEdit()
                             true  → markEditing()        [status "editing"]
commit-key → markEditValidating() → await validate(draft, input)
  string → markEditInvalid(string)         // back to "editing"
  true   → markEditSaving() → await onCellEdit(payload)
    resolve → commitEditSucceeded() → moveFocus(commitDirection)
    reject  → markEditError(message)
```

The engine holds no promises; the orchestrator (a small hook in
`@pretable/react`, e.g. `useCellEditController`) owns the awaits. Headless
consumers replicate this loop against the same sync methods — documented in the
headless docs.

## Column API (`PretableColumn`)

```ts
editable?: boolean | ((input: PretableEditInput<TRow>) => boolean | Promise<boolean>);
validate?: (value: unknown, input: PretableEditInput<TRow>) =>
  (true | string) | Promise<true | string>;   // string = reject message
renderEditor?: (input: PretableEditorInput<TRow>) => ReactNode;   // default: text <input>
parseEditValue?: (raw: string, input) => unknown;   // editor string → typed value
formatEditValue?: (value: unknown, input) => string; // typed value → editor string
```

- `editable` defaults to `false` (opt-in).
- Columns with a custom derived `value` getter remain editable — in controlled
  mode the app decides which field(s) to write in its `onCellEdit` handler, so the
  grid needs no field-mapping knowledge.
- `PretableEditInput` = `{ row, column, value, rowId, columnId }`.
  `PretableEditorInput` extends it with `{ draft, setDraft, commit, cancel }`.

Commit callback on the surface props:

```ts
onCellEdit?: (payload: { rowId: string; columnId: string; value: unknown; row: TRow })
  => void | Promise<void>;   // rejection/throw → "error" status
```

## Async UX, races, errors

- **`checking`**: brief pending affordance; `false` → no-op (no edit begins).
- **`validating` / `saving`**: cell shows pending; all keys except `Escape`
  suspended.
- **invalid**: stay in `editing`, show `error` message; user fixes, re-commits.
- **`error`** (commit failed): retain draft; `Enter` retries (re-runs
  validate→commit), `Escape` reverts.
- **Staleness guard across every async phase**: the orchestrator stamps each
  async step with a token tied to `{rowId, columnId}` + a monotonic edit id; if
  focus moves or a new edit begins before a promise resolves, the stale result is
  dropped (never written to a since-changed cell, never transitions a newer edit).

## Triggers (integrated with focus + single-tab-stop)

- **Begin:** `Enter`, `F2`, double-click, or typing a printable character
  (type-to-replace: the typed char seeds the draft).
- **Commit:** `Enter` (commit → move focus down), `Tab` (commit → move focus
  right, honoring `tabBehavior`), blur.
- **Cancel:** `Escape` (revert, keep focus on the cell).
- Editing suspends range-selection keystrokes while active; the ARIA grid pattern
  and single tab stop are preserved. Editor input gets appropriate ARIA wiring.

## Public surface / packages touched

- `@pretable/core`: new edit-lifecycle methods on `PretableGrid`,
  `snapshot.editing`, new types (`PretableEditState`, `PretableEditStatus`). New
  `@public` symbols → regenerate `core.api.md`.
- `@pretable/react`: `editable`/`validate`/`renderEditor`/`parseEditValue`/
  `formatEditValue` on the column type; `onCellEdit` on `PretableSurfaceProps` (and
  surfaced through `PretableProps`); `useCellEditController`; editor rendering +
  keyboard wiring; default text editor. New `@public` symbols → regenerate
  `react.api.md`. **Run `pnpm api` and commit the regenerated reports** (the
  `API Extractor — report freshness` gate is required — see
  `project_dependabot_api_extractor_gap` memory; regenerate in a clean env).
- Docs: a new `docs/grid/editing.mdx` page + nav entry; a note in the headless
  docs on driving the lifecycle manually.

## v1 scope

**In:** the full async lifecycle (editable / validate / commit), default text
editor + `renderEditor`, `parseEditValue`/`formatEditValue`, the triggers above,
pessimistic commit with pending/error states, staleness guards, controlled
`onCellEdit`, ARIA wiring, docs page.

**Out (later, explicit):** drag-fill, paste-into-range (pairs with the separate
clipboard-paste gap), multi-cell / range editing, optimistic commit, an undo
stack, async commit retry policies beyond manual `Enter`-to-retry.

## Testing

- **Engine (core):** unit-test the sync transition machine — every phase path
  (`checking`→deny, `editing`→`validating`→invalid, →`saving`→success,
  →`saving`→`error`→retry, `cancelEdit` from each phase) and `snapshot.editing`
  shape/identity (cached until next mutation, like the rest of the snapshot).
- **React (RTL):** each trigger (Enter / F2 / double-click / type-to-replace);
  commit-and-move-focus (Enter→down, Tab→right); Escape-revert; async paths via
  deferred promises (deny / invalid / save-success / save-error→retry);
  **staleness** (move focus mid-await → no write, no stale transition);
  `onCellEdit` payload correctness; `renderEditor` escape hatch;
  `parseEditValue`/`formatEditValue` round-trip.

## Open questions / risks

- Exact keyboard hook point in the existing surface keydown handler (where edit
  triggers intercept before range-selection handling) — confirm against
  `packages/react/src` during planning.
- Whether `snapshot.editing` needs the resolved `editable` input cached, or the
  orchestrator re-derives it — settle in planning (lean: orchestrator owns it,
  engine stores only `{rowId, columnId, draft, status, error}`).
- Focus restoration after commit/cancel must not fight the existing
  `selectFocusedRowOnArrowKey` / focus model — verify in planning.
