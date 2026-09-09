# Components SP4A: edit lifecycle safety

Date: 2026-09-08
Status: implemented; final verification recorded in the implementation plan
Program: [component kit audit](../../research/2026-09-08-component-kit-audit.md)

## Purpose and scope

Before adopting kit inputs inside editing sessions, repair the lifecycle those
inputs would expose. The baseline can save while an async editability check is
unresolved, issue duplicate saves, and strand an editor when validation
rejects. Enum label normalization can also unlock checking via a draft write.

The user approved SP4 and a fresh-slate audit, including breaking corrections.
This is the first bounded repair, covering audit A1–A3. Shared kit/listbox
repairs and editor interaction/identity changes follow separately. This spec
does not add Textarea, redesign popups, or change their CSS.

## Chosen approach

Make the existing controller authoritative for edit authorization and commit
admission, and make the indexed core reject ordinary draft writes in pending
phases. Keep React field `readOnly` and keyboard guards as user-facing behavior,
not as the protection against invalid writes.

Alternatives considered:

- **Only guard editor keys:** small, but custom editors and imperative calls
  can still bypass it; enum draft normalization still changes status.
- **Replace the entire edit engine and public status model:** could unify
  transitions, but would unnecessarily mix a core redesign into three proven
  defects. Existing tokens, statuses, and surface reconciliation can support
  the required invariants.

No new dependency is needed. Preserve supported React 18/19 behavior and the
classic JSX build requirements. Breaking changes to unsafe pending mutation
behavior are intentional; no compatibility path may preserve the bypass.

## Controller-owned session

Record the active session's address, generation, authorization state, and
operation phase inside `createCellEditController`. The snapshot's visual
status alone does not grant authority: external draft/status writes must not
turn an unapproved session into an approved one.

An approved session remains authorized across ordinary invalid input and
retryable validation/save failures. A permission check grants authorization
only after it resolves true for the current generation. A returned begin
authorization remains tied to that exact session. When a caller supplies an
authorization token, reject stale or foreign tokens as today; omitting the
token never bypasses internal authorization.

The address and session must still match the current snapshot before any
callback or state transition. `begin`, `cancel`, and `invalidate` retire prior
operations. Completion or rejection from a retired operation cannot mutate
the new session, call a later save, or move focus.

Expose the surface's existing edit-session token through the internal
controller adapter and capture it after begin establishes the edit. Compare
that token as well as the address; a replacement at the same address is still
a different session. The factory test adapter must generate an equivalent
token. Surface lifecycle wrappers must update it for every begin/end path.
Direct callers orchestrating low-level core transitions outside those wrappers
must invalidate the controller; those advanced operations are not a second
route to controller authorization. This adds no public kit prop.

## Admission and transitions

| Current phase                           | Begin                       | Commit                                        | Ordinary draft write                      | Cancel/invalidate |
| --------------------------------------- | --------------------------- | --------------------------------------------- | ----------------------------------------- | ----------------- |
| No session                              | Start permission evaluation | No-op                                         | No-op                                     | Retire generation |
| Checking permission                     | Replace session             | No-op                                         | No-op                                     | Retire generation |
| Authorized editing                      | Replace session             | Acquire commit barrier and parse              | Update draft                              | Retire generation |
| Parsing/validating                      | Replace session             | No-op                                         | No-op                                     | Retire generation |
| Saving/awaiting controlled rows         | Replace session             | No-op                                         | No-op                                     | Retire generation |
| Failed permission check                 | Replace session             | Retry permission, then commit only if allowed | Update draft, without granting permission | Retire generation |
| Recoverable parse/validation/save error | Replace session             | Retry under retained authorization            | Update draft and clear displayed error    | Retire generation |

`commit` acquires the barrier synchronously, before custom parsing, validation,
or save callbacks. A callback reentering `commit` and two calls in the same
event turn therefore cannot issue multiple writes. After every extension
callback, including synchronous callbacks, check the generation before moving
to the next phase; a callback may cancel or replace the session synchronously.

Expose core status `validating` immediately after admission and before consumer
lookup/value/parser callbacks, including when no custom validator is supplied.
This makes synchronous parsing a pending phase visible to `setEditDraft` and
prevents a parser from changing the displayed draft while an older draft is
being saved. Capture the draft for the admitted operation once.

Permission denial cancels the current edit without dispatching a save. A
permission callback failure is different: show an error on the current cell
and retain the draft, with no authorization. A commit retry re-runs permission
first. Retrying a previously authorized validation/save error does not need
another permission request unless the session was replaced or invalidated.
Permission retry acquires its barrier and exposes `checking` synchronously
before invoking the callback; after success it enters `validating` before
parsing. Two immediate retries or a reentrant permission callback cannot start
two permission checks or commits.

Do not treat `onCommit` returning `"keep-open"` as completion. The rows-backed
surface uses it while waiting for controlled rows to reflect the write; retain
the barrier until reconciliation ends the session. Existing model-replacement
and stale-operation paths using that sentinel must remain inert.

Cancelling cannot undo a save already dispatched to an application. The
guarantee is no duplicate dispatch and no stale completion affecting current
state; cancellation is not advertised as transaction rollback.

## Callback failure boundaries

Handle thrown and rejected errors from editability, custom parsing,
validation, and save. Normalize error text consistently. Invalid built-in
parsing and a validator's returned message remain input validation results;
an exception becomes an error that retains the draft and supports retry.

During begin, establish/retire the session generation before invoking consumer
lookup/format/editability code, and end any previous core edit snapshot. A
failed replacement begin leaves both the controller and core with no active
edit, even if the old session was editing or saving; it must not leave an
orphan editor whose commits are all rejected. This does not retract an old
save already dispatched. If failure occurs before a new cell edit can be
established (for example, row lookup or initial formatting throws), leave no
half-open checking state and no reusable authorization; report the failure
through the existing diagnostic mechanism. Do not let a failure in a new begin
leave an old pending permission result able to reopen the old session.

If begin has already established a valid cell session, display its callback
error on that session. After commit begins, lookup/value/parser failures are
displayed on the current edit like validation exceptions. No callback error
escapes an otherwise fire-and-forget UI invocation as an unhandled rejection.

The implementation plan must identify the existing diagnostic helper and
capture its output in tests for pre-session failures; it must not silently
swallow those failures or introduce an unrelated global error API.

## Core draft transition rule

`createGridUiCore.setEditDraft` is an ordinary user draft operation, not a
permission or lifecycle transition. Ignore changed draft writes during
`checking`, `validating`, or `saving`; preserve the phase, draft, and error.
Allow them during editing and recoverable error states, retaining the current
behavior of clearing an input error and returning the visual state to editing.
The controller's authorization remains independent of that visual state.

Synchronous parser reentrancy is covered by the controller barrier; custom
code cannot dispatch a second save even if it calls lower-level core methods.
Audit the surface adapters and all relevant core draft paths so the live
indexed path and tests obey the same rule.

Enum display normalization must wait until permission succeeds. Guard its
effect by status and perform it once per mounted session after initial
permission success; the initial blocked mount must not permanently lose label
normalization. Do not repeat it when validation/save errors return to editing
and overwrite a later user-entered draft. This is a narrow fix
until the later enum identity/query redesign. Do not solve A4's label ambiguity
by changing enum parsing in this lifecycle patch.

## Editor integration

Read-only pending editors must not commit on Enter/Tab. They should consume
those commit/navigation keys so the grid or form does not interpret them;
Escape may cancel. Apply the same admission policy to specialized handlers,
including multiline's explicit Ctrl/Cmd+Enter path and enum's selection path.
Guard draft/selection actions as well as keyboard commits while pending.

Custom editors remain protected by the controller even if they ignore pending
props. Preserve the existing forwarding of native field props and refs. IME,
Shift+Tab, enum clearing, and date browsing semantics are explicitly tracked
for the editor interaction repair, not silently changed here.

## Required validation

Write failing regressions before the production fixes. At minimum:

1. Deferred permission: Enter/Tab and direct commit before false resolution
   produce zero validation/save calls; the pending status and draft persist.
2. Concurrent and reentrant commits call validation/save at most once. Retry
   after a returned validation error or rejected save is allowed exactly once.
   A synchronous parser that calls the real core's `setEditDraft` cannot change
   the admitted draft. Reentrant permission retries start one check only.
3. Each callback failure boundary has recovery coverage. Permission failure
   retry must pass permission before a save. Pre-session failure is diagnosed.
4. Cancel, invalidate, new begin, row/model replacement, and unmount during
   each async phase prevent stale state changes and stale downstream saves.
   Include same-address replacement. A new begin that fails before mounting
   its editor clears a previous editing/saving snapshot and permits a normal
   later begin to work.
5. `keep-open` remains saving and blocks another commit until controlled rows
   reconciliation; boolean immediate commit retains exact-session authorization.
6. Changed `setEditDraft` during checking/validating/saving is ignored in the
   core. Editing/error writes still work. Test real core transitions.
7. A surface enum with differing value/label and deferred permission never
   leaves checking early. After true permission it normalizes its label;
   after false permission it closes without a write.
8. Pending editor Enter/Tab, multiline commit keys, and enum choose actions
   do not commit. Tests exercise both built-ins and a custom editor that tries.

Run package scripts with their jsdom environment. Build dependencies before
tests that resolve package dist. Run the controller/editor/surface editing
regressions, the affected grid-core tests, then relevant type/build checks and
existing controlled-row/boolean editing browser coverage. Heavy builds run
sequentially. This patch changes behavior, not styling; production visual
baseline capture remains required before the following CSS/migration work.

Mutation-check the new admission and generation guards by removing each and
observing its named regression fail. Record the mutations in the commit
message, following the kit's evidence convention. The current audit baseline
passes 156 targeted React and 113 UI tests despite the defects; re-running only
those preexisting tests is insufficient.

## Delivery and later work

Update edit lifecycle docs and add the appropriate public-package changesets
for the shipped behavior, including the intentional pending-draft restriction.
Refresh API reports only if the public surface actually changes.

This patch is complete when A1–A3's reproductions fail to reproduce, the new
regressions and required integration checks pass, and the audit records the
fix evidence. It does not close the component-kit program. The audit's shared
control and editor semantics findings remain explicit subsequent work.
