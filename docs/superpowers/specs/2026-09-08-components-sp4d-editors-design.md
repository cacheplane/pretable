# SP4D: finish editor correctness and kit adoption

Baseline: `04dc1b5e`. User authorizes all remaining follow-ups, PR, merge on green,
and direct Chrome MCP verification. Existing isolated worktree is retained.

## Design

Repair the existing typed editors rather than replace them with native pickers
(which loses scoped styling) or redesign the controller (whose lifecycle guards
are verified). Controller remains the only commit authority. Breaking corrections
are permitted, and are documented in a changeset.

Enum: keep editable query separate from an intentional canonical choice. An
internal tagged draft may carry chosen identity through synchronous setDraft
and controller parsing; never round-trip the chosen label. Validate membership
before built-in commit, and unwrap the value as text for custom parseEditValue
(which remains authoritative). A pristine existing selection keeps its identity,
including duplicate labels/value-label collisions. Typed text resolves only if
its case-insensitive label/value matches identify exactly one distinct option;
ambiguous text produces a recoverable validation error, never picks the first.
Blank query commits null via Enter/Tab/blur unless the user intentionally
navigated to an option. Escape cancels. Explicit keyboard/click choices commit
that identity. Preserve permission, error recovery, pending and stale-session
invariants. Seeded type-to-replace must not be normalized to an old selection.

Composition: shared guard checks native isComposing, compositionstart/end state,
and legacy keyCode229 before specialized editor and surface key behavior.
Composition keys retain browser defaults and cannot commit/cancel/step/navigate
or enter an edit. Do not suppress the next genuine command after composition.
Shared direction policy: Tab right, Shift+Tab left; Enter down, Shift+Enter up.
Multiline plain/Shift+Enter remain native newlines; Ctrl/Meta+Enter commit with
that directional policy. Pending controls remain inert.

Date: editable combobox with a grid popup, truthful expanded/haspopup=grid,
controls and active-descendant only for mounted popup nodes. DOM focus stays
on the text input. Separate calendar cursor from draft: arrows/PageUp/PageDown
browse only; Enter intentionally chooses a navigated cursor, while Tab/blur
commit typed/current text. Left/Right/Home/End retain caret behavior before
calendar navigation; ArrowDown/Up enter calendar navigation, typing returns to
text editing. Month buttons browse without selection; clicks choose dates.
Escape cancels the edit. Empty text clears, invalid text is not silently saved,
null/invalid/custom-parser seed handling retains existing safety. The active
cursor and selected date have distinct normal/forced-color state. Boundaries
stay within supported calendar range. Disabled/pending calendar actions expose
truthful state. Editor popups follow live layout with the existing observer.
Reference: https://www.w3.org/WAI/ARIA/apg/patterns/combobox/ (read 2026-09-08).

Kit: add native PretableTextarea with forwarded cleanup-aware ref, native props,
site and data-pretable-textarea. Export props/component slot, wire memoized
resolution. Migrate text/number/enum/date inputs through components.TextInput,
multiline through Textarea, date month and number step buttons through the kit
IconButton. Preserve existing class/data hooks and documented site identifiers.
Do not convert calendar gridcells into conflicting button roles. Ensure editor
geometry and error/pending/focus precedence survive base kit styling. Consumer
replacements must receive real refs, names, handlers and pending state.

Close remaining documentation inaccuracies: props cross portals, button.value
exists, native checkbox supports tabindex. Accessible-name warning is explicitly
a heuristic unless tightened with meaningful regressions. Rename stale test
names that claim development-only warnings; preserve historical release notes.

## Verification and delivery

Observe RED regressions for identity, ambiguity, clearing, reverse navigation,
composition, date browsing without writes, ARIA, overrides/ref and CSS states.
Focused/full React and UI tests, public types/API, React18/19 packed matrix,
production build, docs guards, lint/format. Direct Chrome MCP interaction and
accessibility snapshots plus Chromium/WebKit automated flows and inspected
screenshots. Synthetic composition tests are not a claim of physical OS IME or
human screen-reader validation; record that boundary honestly.

Update the audit with evidence for every remaining finding. Review implementation
independently, push PR, resolve required checks/review findings, merge only green,
then verify merged/deployed state in Chrome MCP. Never claim human validation
performed by automated browser tools. No unrelated dependency changes.
