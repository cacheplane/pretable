# Components SP4C: overlay ownership and visible states

Date: 2026-09-08
Baseline: `356e447f`
Status: implemented, independently reviewed and verified; see SP4C plan

## Scope and design choice

User authorization covers continuing the fresh-slate audit and breaking fixes.
Repair A7 (sibling popup dismissal), A11 (scoped portal themes), A12/A13
(disabled/forced-colors states). Also namespace the touched listbox active
attribute. Editor A4–A6/date semantics remain separate.

Use explicit logical containment for outside presses, and an explicit public
portal container for CSS scope. A global single-open flag would incorrectly
close parent popups; blanket propagation suppression hides sibling presses.
Copying computed styles cannot reliably reproduce arbitrary live CSS scope.
The explicit container makes theme ownership a normal CSS inheritance choice.

## Portal scope API

Export `PretableOverlayProvider` and `PretableOverlayProviderProps` with
`container: HTMLElement | null` and `children: ReactNode`. All existing
OverlayPortal consumers use the nearest provider. Without a provider, retain
the document.body default. Inside a provider, null means wait for its target;
do not briefly fall back to body. The provider adds no visual wrapper and is
SSR/hydration-safe. Switching targets moves mounted portal content through
React's normal lifecycle; do not promise focus preservation across replacement.

The documented scoped-theme pattern places the grid and a portal host inside
one themed section, with the host outside the grid's clipping viewport. Tokens,
dir, color-scheme and their live changes inherit naturally from that section.
A provider alone does not copy styles from its trigger. Move grid-only overrides
to the shared section or explicitly theme the target. Target must be connected,
in the same document as the trigger, outside clipping/transformed containing
blocks, and controlled by the application; no automatic transformed-coordinate
support is promised. Nested providers choose their nearest target.

Delayed attachment is explicit: preserve a popup's open intent while its
provider target is null, but emit expanded/controls/active-descendant state
only when the popup can actually render. Apply the target readiness gate to
Select and to enum/date active-descendant references. Focus-taking menus must
focus on actual portal attachment (including null→target and hydration), not
only on their component's initial mount. Reposition/ordinary rerenders must not
repeatedly steal focus. Tests cover opening before a target exists, supplying
it, removing it, and attaching again.

## Logical containment and dismissal

Each portal retains a hidden origin marker in the React/DOM source tree and a
nonvisual `display: contents` portal boundary in the target. A weak registry
maps the boundary to its origin. A shared containment helper follows origin
links, so an event in a nested portalled list counts as inside its parent
filter dialog, while a sibling's popup/trigger counts as outside. No global
single-popup singleton; separate grids and nested menus must coexist correctly.
Unregister boundaries on detach and target replacement.

Use a shared capture-phase outside-pointer listener so unrelated bubbling
stopPropagation cannot hide outside presses. Exempt both the owning popup root
and its trigger. Integrate Select/Listbox, FilterMenu, ColumnMenu and shared
menu-keyboard users, passing trigger references through their internal callers
where needed. Remove popup/trigger blanket pointer suppression whose sole job
was dismissal. Preserve independent drag/grid selection propagation controls
when they serve a different purpose, documenting those cases. Nested portal
containment must work without blanket suppression. Keep existing Escape/Tab
focus semantics: inner Escape closes only the inner popup; outside press does
not return focus; pressing the same trigger toggles closed without reopening.

Origin/boundary markers are internal DOM details. Replace tests assuming the
list is a direct body child with assertions that it escapes the clipping grid
and resides in the chosen portal target; do not weaken focus or dismissal tests.

## Visual states

Before CSS edits, capture a browser baseline for actual kit state markup with
the current stylesheet. Cover enabled/disabled options, committed vs active
options, and checked/mixed/unchecked checkboxes in light/dark and forced colors.

Rename listbox `data-active` to `data-pretable-active`; update runtime, CSS,
current tests/docs and migration note. Keep historical changelogs intact.
Disabled options use disabled ink/cursor and never acquire enabled hover paint.
In forced colors, active option focus has a visible system-color outline
independent of committed selection. Define selected+disabled combinations
explicitly so disabled ink wins. Define checked/mixed+disabled checkbox fill,
border, glyph and focus using coherent system color pairs; no author border or
outline colors under forced-color-adjust:none. Disabled controls remain visibly
disabled, with checked/mixed glyphs still legible. Do not rely on opacity alone.

Use browser computed-style checks and inspected screenshots. Chromium provides
forced-colors emulation; report its boundary, do not claim physical Windows
high-contrast or human screen-reader validation. Verify ordinary rendering in
Chromium and WebKit and live local-theme/direction changes for two scopes and
a nested popup. Keep changes confined to these state defects.

## Verification

TDD: sibling Select A→B; same-trigger toggle; outside target stopping bubble;
inner list keeps filter/menu parent; sibling nested selects dismiss only sibling;
Escape focus and portal registry teardown; provider null/default/custom/switch,
SSR/hydration and nearest nested target. Reproduce old disabled/forced-color
combinations in CSS/browser checks before fixes. Mutation-check containment
ancestry and trigger exemption plus disabled/active styling guards.

Then targeted overlay/control/filter/tool-panel suites, full React and UI
suites, public type tests/API reports, builds and lint/format. Run production
browser component flows plus scoped-overlay/state fixtures, inspect before/
after screenshots, and record exact results. Docs must distinguish explicit
theme-container setup from automatic style copying. Add React minor and UI
minor changesets for new API/attribute migration. Commit locally, no publishing.

## Visual QA correction

Production screenshots exposed stale popup coordinates after a live direction
change moved the trigger. Select and header popovers must remeasure when their
anchor layout or ancestor direction/style changes, including deferred target
attachment. Keep this observation bounded to open overlays and avoid state
updates for unchanged rectangles. Production assertions now check attachment
to the moved trigger as well as CSS inheritance; both Select and header-menu
assertions failed against the first integration build.
