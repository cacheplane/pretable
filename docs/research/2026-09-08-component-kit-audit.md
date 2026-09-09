# Component kit audit

Date: 2026-09-08
Baseline: `53c4a000` (`@pretable/react` 0.18.0)
Status: A1–A3 and A7–A14 repaired; A4–A6 remain open

## Mandate and boundaries

The user approved continuing SP4 and requested a fresh-slate audit. Existing
SP1–SP3 decisions are revisable, and breaking changes are allowed when they
correct a defect. The earlier handoff's frozen-contract language therefore
does not govern new decisions.

Reviewed: the five kit components, listbox keyboard/markup, context and refs,
editor adapters and controller, their surface/core integration, relevant
styles/themes, tests, and documentation. This is a targeted source and runtime
audit, not a claim that every grid subsystem is correct. No production-browser
visual measurement, physical IME session, or human screen-reader pass was
performed in this audit.

The handoff describes a native date picker; the source already contains a
custom calendar. SP4 must start from the source's behavior.

## Evidence

Using Node 24.20.0 and the repository-pinned pnpm 10.12.1:

- `pnpm --filter '@pretable/react...' build`: passed.
- `pnpm --filter @pretable/react test components use-cell-edit-controller cell-editor`:
  12 files, 156 tests passed.
- `pnpm --filter @pretable/ui test`: 4 files, 113 tests passed.

The tests were run through the package scripts, including jsdom. These are
targeted baseline checks, not the full workspace or browser suites. The
machine's default pnpm 11 initially added an `allowBuilds` placeholder and
rejected its install; that generated change was removed and installation
completed with pinned pnpm. No dependency manifest or lockfile change remains.

Independent temporary harnesses against the baseline source produced:

```text
Two sequential trigger presses: open listboxes= 2
Shrink options while open: active descendant exists= false
Empty options while open: expanded= true listboxes= 0
ReactNode Beta typeahead active= Alpha
React 19 callback ref: cleanup= 0 null calls= 1
Save before denied editable resolves: 1
Concurrent save calls: 2
Validator failure escaped: validator rejected remaining status: validating
Second duplicate-label option parsed: { ok: true, value: 'a' }
```

The control harness used React 19, jsdom, and Testing Library against source
imports. The controller harness used the exported controller factory with a
minimal stateful grid adapter and deferred promises. The enum parser result
was checked directly. These demonstrate the stated behaviors; they do not
substitute for the surface and browser regressions required by the repairs.

## Lifecycle repair verification

A1–A3 were repaired in `8f4268ac`, `c8e94e4e`, `b70e6637`, and
`bc6c3065`. Final checks passed: 1,939 React tests, 194 combined internal/public
core tests, React/core type checking, 26 documentation tests, production site
build, and six Chromium/WebKit editing checks. Mutation checks verified the
admission, stale-session, pending-draft, parser-await, pending-key, and enum
normalization guards. See the [implementation plan](../superpowers/plans/2026-09-08-components-sp4a-lifecycle.md)
for commands and review evidence. This phase closed A1–A3; current resolution
statuses appear below.

## Control-state repair verification

A8–A10/A14 are repaired by `8b6a1bf3`, `e0a648d1` and the final Select helper
integration. Verification and migration details are in the
[SP4B plan](../superpowers/plans/2026-09-08-components-sp4b-control-state.md).
No CSS was changed in SP4B; overlay and visual repairs follow below.

## Overlay and visual-state repair verification

A7/A11–A13 are repaired in `21421a79`, `19cd1bae` and `bd5fe3c1`.
Scoped inheritance requires the documented explicit provider host; body
remains the default. Visual QA also exposed and repaired stale anchoring when
live direction changes move a trigger. React and UI migrate together to the
`data-pretable-active` marker.

Verification passed 1,987 React tests, 116 UI tests, the packed React
18.0.0/18.3.1/19.2.8 matrix, 38 documentation guards, and the production build.
The [SP4C plan](../superpowers/plans/2026-09-08-components-sp4c-overlays.md)
records final browser/type/API results, independent reviews and mutation checks.
[Visual evidence](assets/sp4c/README.md) separates production scoped popups
from exact-markup CSS state checks. Forced-color evidence is Chromium emulation;
physical Windows and human assistive-technology checks remain unperformed.

## Findings

The descriptions and line references below record the baseline defects. A1–A3
are resolved by the lifecycle repair; A8–A10/A14 by the control-state repair.
A7/A11–A13 are resolved by the overlay repair. A4–A6 remain open.

### A1 — P1: a pending edit can commit before permission resolves, or save twice

**Resolved:** controller-owned permission and commit admission, exact session
identity, pending core draft protection, and pending editor command guards.

`packages/react/src/use-cell-edit-controller.ts:152` admits a commit whenever
an edit exists. The optional authorization argument checks identity only when
supplied; the normal surface editor calls `commit(dir)` without it at
`pretable-surface.tsx:7709`. The shared keyboard handler commits Enter/Tab
without checking pending status (`editors/use-editor-field.ts:55`).

Reproduce with a deferred `editable` callback: begin, commit, then resolve
permission false. One save has already happened. With a deferred save, call
commit twice: the callback runs twice. Tokens suppress stale completion
updates but cannot retract dispatched writes. This bypasses the application's
editability predicate; it is not evidence of bypassing server authorization.

Repair: controller-owned authorization and allowed transitions, a synchronous
single-flight barrier before callbacks, and keyboard guards as a second layer.

### A2 — P1: extension failures escape and leave pending states stuck

**Resolved:** callback failures retain a recoverable draft; permission retries
recheck authorization; asynchronous parsing is awaited; stale completions are
inert. Failed replacement begins retire the previous edit before callbacks.

`use-cell-edit-controller.ts:140,169,189` invokes `editable`, `parseEditValue`,
and `validate` outside the save catch. A rejected validator leaves
`validating` and rejects the controller promise. Surface callers discard that
promise with `void`. Permission rejection similarly strands `checking`.

Repair: token-aware error recovery for every callback boundary, with an
explicit retry policy that cannot manufacture permission after a failed check.
Also cover `formatEditValue` and row/value lookup failures at begin/commit.

### A3 — P1: enum label normalization changes checking into editing

**Resolved:** pending core draft writes are ignored and enum normalization waits
for permission. User corrections after permission errors are preserved. Real
surface regressions cover allowed and denied deferred permission.

`editors/EnumCellEditor.tsx:106` writes the label into the draft on mount.
`packages/grid-core/src/create-grid-ui-core.ts:891` changes every changed
draft write to status `editing`. An async-editable enum whose value and label
differ therefore becomes writable before permission resolves.

This chain is source-confirmed, with a surface reproduction required during
repair. Do not fix only the enum effect: draft writes must not unlock a
pending phase, and the controller must independently require authorization.

### A4 — P1: enum labels are used as identity and can save the wrong value

`EnumCellEditor.tsx:130` writes the chosen label, and
`editors/enum-options.ts:19` resolves the first label match. For values `a`
and `b`, both labelled `Same`, clicking `b` writes text that parses to `a`.
Value/label collisions and case-folding produce related ambiguity.

Repair: distinguish the canonical selected value from editable search text.
A clicked option commits its identity, not a round-trip through its label.
Typed ambiguous text must require a choice rather than silently take the first.

### A5 — P2: composition keys are treated as editor commands

No composition guard exists in `use-editor-field.ts`, the specialized editor
key handlers, or the surface's edit-entry keyboard path. Enter confirming an
IME candidate can commit the cell; number/date arrows can consume candidate
navigation. This is a source-confirmed missing guard; validate actual IME
behavior in a browser in addition to synthetic regression events.

Repair: one composition policy before editor-specific and grid key behavior,
including composition state and the relevant browser fallback. Preserve native
text editing rather than intercepting composition keys.

### A6 — P2: enum clearing and reverse navigation are broken

Empty enum text cancels on blur (`EnumCellEditor.tsx:181`), and Enter/Tab
chooses the highlighted first option. The parser supports empty → null, but
the editor offers no reliable way to reach it. Separately, shared Tab handling
and the enum override always move right, including Shift+Tab.

Repair: an explicit empty query commits null absent an intentional option
choice; Shift+Tab commits left. Share the directional policy. Decide
Shift+Enter consistently with existing grid navigation when specifying the
editor interaction change.

### A7 — P2: sibling selects can leave multiple popups open

**Resolved:** Capture-phase outside presses follow logical portal ancestry and exempt the owning trigger. Siblings dismiss; nested portals preserve their parent. Escape unwinds one layer without stealing outside focus.

Every Select stops pointerdown propagation (`components/select.tsx:250`),
while Listbox dismisses from a bubbling document listener (`listbox.tsx:127`).
Click A, then B: A never observes the outside press. Both remain expanded.

Repair: explicit overlay ownership, with the trigger and descendant portals
treated as inside the owning overlay. Sibling overlays are outside. Preserve
the important nested-filter case without blanket propagation suppression.
Test focus transfer and keyboard dismissal as well as clicks.

### A8 — P2: changing options invalidates active-descendant state

**Resolved:** Active identity now follows the option value across roster changes, with
an enabled fallback on removal/disable and no stale resurrection. Empty Select
rosters close; all-disabled lists have no active descendant or commit.

`listbox.tsx:272` reseeds activeIndex only on open. Shrinking an open roster
leaves a nonexistent active id; emptying it leaves an expanded trigger with no
list; reordering can silently highlight a different value.

Repair: track/reconcile active identity, select an enabled fallback when
removed/disabled, and close an empty roster. Emit ARIA references only for
rendered targets. Cover reorder, shrink, removal, disabling, and all-disabled.

### A9 — P2: rich option labels cannot use typeahead

**Resolved:** Rich labels now require explicit `textValue` in the public/internal option
union. Primitive labels retain inferred text; migration docs and public type
tests cover the deliberate type tightening.

The public option label is `ReactNode`, but `listbox.tsx:84` recognizes only
strings and numbers. `<span>Beta</span>` is visible but cannot match `b`.
The comment claiming rendered-text support is incorrect.

Repair: require an explicit textual representation for rich labels (a
discriminated option shape can enforce this), while inferring it for plain
strings/numbers. Do not attempt to execute arbitrary React components to
discover text.

### A10 — P2: merged refs discard React 19 cleanup callbacks

**Resolved:** Select, Checkbox and TextInput share cleanup-aware ref composition.
Replacement, StrictMode and detach are tested; packed consumers verify cleanup
under React 18.0.0, 18.3.1 and 19.2.8.

`select.tsx:145`, `checkbox.tsx:102`, and `text-input.tsx:85` discard the
return value of consumer callback refs. The baseline invokes `ref(null)` but
never the supplied cleanup. React 19 explicitly supports returned cleanup
functions; see [React's ref callback contract](https://react.dev/reference/react-dom/components/common#ref-callback).

Repair: a shared ref-composition helper covering React 18 null detach and
React 19 returned cleanup. Test ref replacement, unmount, and StrictMode
lifecycle, not just initial node assignment.

### A11 — P2: portalled content loses scoped theme and direction inheritance

**Resolved:** The public `PretableOverlayProvider` supports an explicit host in the local theme/direction scope, outside the clipping viewport. Applications must configure that host; the default remains body and does not copy trigger styles. Null targets wait with truthful ARIA and attachment-time focus.

`overlay/OverlayPortal.tsx:19` always portals to body. A grid under a locally
scoped token override or dark theme therefore has a correctly themed trigger
and a popup inheriting the body theme. The per-section theming recipe promises
scoped overrides (`apps/website/content/docs/theming/override-tokens.mdx:109`).

Repair: a documented overlay theme/direction scope that survives escaping the
clipping viewport. React context survives a portal, but CSS inheritance does
not. Validate multiple differently themed grids and nested popups on one page,
including live theme changes. Merely copying `data-theme` misses custom tokens.

### A12 — P2: disabled and forced-colors listbox states are incomplete

**Resolved:** Disabled options keep disabled ink/cursors without enabled hover paint. Forced-color active outlines and selected-disabled combinations are explicit. The active marker is now `data-pretable-active` in React, CSS and current docs.

`packages/ui/grid.css:227` gives all options a pointer cursor and hover fill;
`aria-disabled` is not styled. The forced-colors rule at `:2469` addresses
committed selection only. Keyboard highlight uses an author background, with
DOM focus retained on the trigger, so it has no independent system-color
indicator when moving away from the selected option.

The missing state selectors are proven; visual consequences need browser
measurement. Add disabled ink/cursor and guarded hover, and distinguish active
focus from committed selection in forced colors. The current CSS guards assert
individual rules, not these state combinations.

### A13 — P2: checked/disabled checkboxes collide in forced colors

**Resolved:** Disabled checkbox states have distinct ordinary styling and explicit system-color fill, glyph, border and outline pairs. Chromium forced-color and ordinary Chromium/WebKit screenshots were inspected.

The disabled `GrayText` rule at `grid.css:2454` loses to the later
checked/mixed `HighlightText` rule at `:2480` at equal zero specificity.
That checked rule sets `forced-color-adjust:none` but leaves author border and
focus colors in place. Define the combined states with system border, fill,
glyph, and outline colors and verify contrast visually.

### A14 — P3: typeahead buffer survives closing and reopening

**Resolved:** Typeahead clears at popup session boundaries. A fake-timer regression and
real Chromium/WebKit rapid-reopen flow reproduce the old bug and verify repair.

`listbox.tsx:284,337` resets the buffer only after its 500ms timer. Type `b`,
close, reopen quickly, type `a`: the next session searches `ba`. This is
source-confirmed and needs a fake-timer regression. Reset on session boundaries.

## Additional corrections and design questions

- **Resolved in SP4C:** renamed bare `data-active` to `data-pretable-active`, updating consumers,
  guards, docs, and migration notes. Old release notes are historical records;
  document the new name in the new release rather than rewriting history.
- Fix the four stale “warns in development” test names. `warnOnce` also runs
  in production. `hasAccessibleName` is a heuristic: nonexistent labelledby
  targets and empty labels suppress warnings. Either tighten it against the
  actual named DOM nodes or describe its limitations accurately.
- Correct the claim that buttons have no `.value`; HTMLButtonElement does.
  The data attribute represents this component's committed value by design.
- Correct “context crosses portals, props do not”: props can be passed through
  portal-rendered React trees; context avoids manually forwarding every slot.
- Native checkboxes do support tabindex. The docs' stated rationale for a
  button checkbox is overstated. No demonstrated defect currently warrants
  replacing that implementation wholesale; verify its native accessibility
  tree and label interaction before keeping the rationale as a guarantee.
- Date input supplies active-descendant to a plain textbox without a complete
  combobox/grid-popup contract. Define it against the
  [WAI combobox pattern](https://www.w3.org/WAI/ARIA/apg/patterns/combobox/).
  Calendar cursor navigation currently writes the draft, so browsing a month
  then blurring can save a new date. Prefer separate cursor and committed
  selection; this is a deliberate behavior change, not pixel parity work.
- Date navigation and number steppers remain native buttons. They must be
  included in the final control inventory; migrating five fields alone does
  not mean every editor control uses the kit.
- Moving editors onto TextInput without changing state precedence would erase
  the invalid outline at `grid.css:1500` with the final focus outline shorthand
  at `:2206`. This is a migration hazard, not a current native-editor bug.

## Repair sequence

1. **Lifecycle safety:** A1–A3. Specify and enforce authorization, phase,
   single-flight, errors, stale results, and pending draft rules. This is the
   first bounded implementation spec.
2. **Shared kit foundations:** A7–A14, overlay scope, names and documentation.
   Capture production visual baselines before any styling changes. Resolve
   the overlay theme API in its own design, with live scoped-theme examples.
3. **Editor semantics and SP4:** A4–A6, date interaction/accessibility,
   TextInput adoption, Textarea, editor buttons, and state CSS. Thin kit
   controls carry native/ARIA state; the edit controller retains lifecycle
   authority. Each deliberate visual or interaction change is recorded.

These are separate reviewable changes within the component-kit program. A
one-shot rewrite would combine state authority, popup ownership, and editor
semantics in a way that makes regressions difficult to attribute. Conversely,
the original five-field migration alone would preserve demonstrated bugs.

Completion requires all findings above to be repaired or explicitly resolved
with evidence, plus production browser checks and a clearly reported human
assistive-technology validation boundary. Passing the existing 269 targeted
tests is a baseline, not that completion criterion.
