# Components SP4B: control state and refs

Date: 2026-09-08
Status: implemented and verified; evidence in the SP4B implementation plan
Baseline: `c1cc8290`

## Scope and decision

The user authorized continuing the component-kit audit repairs, including
breaking corrections. This increment fixes A8, A9, A10 and A14. A7 popup
ownership belongs with A11 portal scope because both affect nested overlays;
A12/A13 require production visual baselines and remain separate. No CSS or
editor value/keyboard semantics redesign is included here.

Keep the existing Select/Listbox architecture and repair its state contracts.
A full control replacement adds unnecessary migration work; index clamping
alone would silently select a different option after a reorder. Track active
option identity instead. Keep the internal index-shaped hook result so the
enum editor can share the corrected navigation without a public editor change.

## Option roster and typeahead

Option values are stable unique identities. While open, preserve the active
value across reorder and insertion. If removed or disabled, select the first
enabled option; with none enabled, expose -1 and no active descendant. Opening
seeds the enabled selected value, otherwise the first enabled option. An empty
Select roster closes synchronously and removes its controls/active-descendant
references. Re-population does not reopen it. An all-disabled nonempty list can
remain open but cannot commit or expose an active descendant. Never emit an
active-descendant id that does not exist in the rendered list.

The shared keyboard hook resolves against the current roster before rendering
or committing. Reset typeahead at open/close boundaries and on unmount, not
only after the existing 500ms timeout. Preserve existing accumulated-prefix
matching within one session. Do not add new repeat-character or IME policies.

A public option becomes a union: string/number labels allow optional
`textValue`; other ReactNode labels require `textValue: string`. Explicit text
is the typeahead source; otherwise infer from the primitive label. Do not
execute or introspect React components. Keep public and internal option types
aligned and update exported API reports and migration docs. Existing plain
labels remain source-compatible. Runtime JavaScript callers missing text must
remain safe (no match), while TypeScript rejects missing text on rich labels.

## Ref lifecycle

Use one internal ref-composition helper for Select, Checkbox and TextInput.
Consumer object refs receive node then null. Callback refs returning nothing
receive node then null. Callback refs returning cleanup run that cleanup
exactly once per attachment and do not also receive null. Clear internal refs
on detach. Ref replacement and StrictMode attach/detach must work without
stale nodes, duplicate cleanups, or React 18 callback-return warnings.

The helper may return a void callback and internally invoke a stored cleanup
on React's null detach, which supports React 18 and React 19 without runtime
version checks. It must preserve stable callback identity when refs are stable.
It is internal, not a new public export. This follows the supported React 19
[callback ref contract](https://react.dev/reference/react-dom/components/common#ref-callback),
including its compatibility null-detach path for callbacks without a return.
Revisit the adapter if a future React release removes that compatibility path.

## Verification and completion

Add failing behavior tests before implementation: reorder/remove/disable/empty
and all-disabled rosters, selected-disabled seed, immediate typeahead reopen,
rich-label explicit text and type-level rejection, and actual control ref
replacement/unmount/StrictMode. Run existing component and enum-editor suites
for shared-hook regressions. Test helper null-detach explicitly for React 18's
contract; validate production builds against the repository's React 19 runtime.

Use focused mutation checks for identity reconciliation, typeahead boundary
reset and cleanup invocation. Then full React tests, typecheck, API report,
changed-file lint/format and production build. Existing browser Select/filter
flows verify the built package integration. Record precise evidence and leave
A7/A11–A13 and editor A4–A6 open. Commit locally; no merge or publication.
