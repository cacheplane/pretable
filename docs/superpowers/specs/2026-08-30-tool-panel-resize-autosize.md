# Pane Resizing + Auto Width (Tool Panel SP5) — Design

**Status:** approved direction, specced in full.
**Parents:** `2026-08-24-tool-panel-design.md` — both items sit on SP1's
out-of-scope-but-designed-for list: "panel width resizing" and "column
autosize action in the kebab (menu is built to take it later)".

## What this is

Two finishing touches on the tool panel, one PR:

- **A. Pane width resizing** — a drag handle on the pane's grid-side edge,
  with keyboard parity, bounds, and the surface's controlled/uncontrolled
  convention.
- **B. Auto width in the columns section** — the kebab gains an "Auto
  width" toggle per column, and the section footer gains "Auto-size all
  columns", both over the auto-width machinery that already exists.

## Facts the design rests on (verified in code)

1. Pane width is a plain `inline-size: 264px` at (0,0,0) specificity in
   `grid.css` (~1462), documented as consumer-overridable; the pane is a
   "fixed budget the grid area yields", and the virtualizer already
   observes resize (SP1).
2. Auto width is a **mode bit, not a content fit** (verified in a real
   browser, 2026-08-30 — the first draft of this fact claimed content
   tracking and was WRONG): `createAutoWidthStore` (pretable-model.ts)
   holds the set of column ids whose width is **grid-managed** — the
   engine's stored width is withheld from the renderer
   (`mergeRenderColumns` strips `widthPx`), and the renderer draws its
   own default (140px, 220px wrapped — `resolveColumnWidth`) or a flex
   share when the column declares `flex`. **Nothing measures cell
   content anywhere in the column-width path** (the canvas text
   measurement feeds row heights only). Columns with no declared
   `widthPx` start auto; `setColumnWidth(id, px)` flips to manual;
   `autosizeColumns()` marks all columns auto (its name over-promises —
   filed for rename, out of scope here). Toggling auto OFF on a
   never-resized column visibly jumps 140→160 (grid-core's
   `DEFAULT_COLUMN_WIDTH_PX` never matched the renderer fallback —
   unification filed, out of scope).
3. The pane's keyboard walks (columns, grouping, custom-section e2e) pin
   tab-stop rosters, and the tab-exit guard is a hard gate — a new
   focusable in the pane moves rosters deliberately, never accidentally.

## Decisions — A. Pane resizing

A1. **The handle is the pane's inline-start edge** (the pane/grid seam): a
slim grab strip (`data-pretable-pane-resize`), full pane height,
≥24px hit area on coarse pointers via the established coarse-pointer
hit-area pattern. Zero new tokens; the visible affordance reuses
existing rule/hover tokens.

A2. **Live resize, pointer-captured, Escape-cancels.** Capture at
pointerdown (the recorded rAF-coalescing lesson); width applies
continuously during the drag (chrome-cheap; the grid reflows through
the virtualizer's resize observer); Escape mid-drag restores the
drag-start width; release commits. Double-click resets to the default
width.

A3. **State is React chrome state with the surface's assert-and-report
trio**: `defaultPaneWidthPx?` / `paneWidthPx?` / `onPaneWidthChange?`
on `PretableToolPanelConfig` — the same controlled/uncontrolled
contract as `activeSection` (SP1 decision 5: chrome state is
React-owned; engine state would be dead surface for headless
consumers). Rejected: uncontrolled-only — cheaper, but it breaks the
surface's otherwise-universal convention for interactive chrome, and
a persisted-layout consumer needs the controlled form.

A4. **Bounds, clamped everywhere**: a `MIN` floor (exact px chosen at
implementation by measuring the filters section's narrowest usable
row — the spec's rule, not a magic number) and a dynamic max
(`surfaceWidth − rail − a grid minimum`), applied to drags, keyboard
steps, AND incoming controlled/default values. A controlled value
outside bounds renders clamped and reports the clamped value.

A5. **No inline style until someone acts.** Untouched and uncontrolled,
the pane keeps its stylesheet width — so the documented consumer css
override keeps working exactly as today. The first drag/keyboard
change (or a controlled/default prop) switches to an inline
`inline-size`, which outranks any stylesheet. Documented on the docs
page beside the existing override note.

A6. **Keyboard parity (WCAG history makes this non-optional):** the handle
is focusable, `role="separator"` with `aria-orientation="vertical"`,
`aria-valuenow/min/max`, ArrowLeft/ArrowRight adjusting by 16px
(direction-aware: "grow the pane" is the same arrow that drags the
seam that way in the current writing direction — follow the header
column-resize's RTL treatment), Home/End to min/max, Enter resets to
default. It is a NEW tab stop inside the pane: every keyboard-walk
roster that enumerates pane stops is updated deliberately, and the
tab-exit guard must stay green.

A7. **No persistence** (no saved-views concept — unchanged from SP1);
consumers persist via the controlled trio.

## Decisions — B. Auto width

B1. **The kebab item is a TOGGLE named for the real semantic.** The menu
gains a `role="menuitemcheckbox"` "Auto width" item, checked when the
column is in the auto set. Its meaning — stated identically in the
docs — is "let the grid manage this column's width" (renderer default,
or a flex share when the column declares `flex`), NOT "fit to
content". On → grid-managed; off → manual at the engine's current
stored width. The 140→160 jump for a never-resized column is
documented plainly rather than hidden. Rejected: an AG-style one-shot
"Autosize" action — no machinery computes a content fit, and shipping
the word "autosize" over a mode bit would be a lie the toggle avoids;
a true fit-to-content action is new machinery, filed as a future
candidate, out of scope.

B2. **Public handle gains `setColumnAutoWidth(columnId, auto)`**,
mirroring `setColumnWidth`'s shape and TSDoc conventions;
`autosizeColumns()` keeps its all-columns meaning and its name. The
kebab writes through the new method. (Handle addition → api report
moves; docs guard will demand registration.)

B3. **DROPPED: no "Auto-size all columns" footer action.** Its value was
predicated on the fit-to-content reading; over a mode bit it is a
low-value mass toggle with a misleading pedigree (`autosizeColumns`'s
name). Per-column control via the kebab suffices; Reset columns
already restores the initial auto set (B4). Revisit only with the
fit-to-content machinery.

B4. **Reset columns restores the INITIAL auto set** — audit item: verify
whether today's Reset already does (the initial set is "columns
without declared widthPx"); if it doesn't, fixing it is in scope,
because a Reset that restores order/pin/visibility but leaves
auto-mode drift is a half-reset. Test both directions.

B5. **The menu component sheds its stale name.** `ColumnPinMenu` grows a
non-pin item; rename to what it is (e.g. `ColumnRowMenu` — the
columns-section row's menu; exact name at implementation, following
directory conventions). No-backcompat repo; internal component.

B6. **Interaction with manual resize, documented not fought**: dragging a
column's header resize strip (or the pane's setColumnWidth path)
already flips auto off — the toggle reflects that on next open. The
docs state the pair plainly: auto tracks content until you size the
column yourself; the toggle turns tracking back on.

## Verification

- **A (resize):** jsdom — drag commits width within bounds; Escape-cancel
  restores; double-click resets; controlled trio asserts-and-reports
  (including out-of-bounds clamp report); no inline style before first
  interaction (assert the attribute is absent, then present after a
  drag); keyboard: arrows step (both directions × both writing modes if
  the harness allows), Home/End, Enter-reset, aria-value* correctness.
  Playwright — pointer drag on the real seam resizes pane AND grid
  reflows (assert a grid column count/position change or scrollbar
  change, not just the pane's width); the keyboard walks' updated rosters
  pass; tab-exit guard green; coarse-pointer hit area ≥24px (the touch
  spec's existing pattern).
- **B (auto width):** jsdom — the toggle reflects the live set (a column
  with declared width starts unchecked; one without starts checked);
  toggling on makes a content change ACTUALLY change the drawn width
  (disprove-capable: two contents with different widths — assert the
  header cell's width moves, not that a method was called); toggling off
  freezes it at the engine's stored width; manual header resize
  unchecks it on next open; Reset restores the initial set (B4, both
  directions). The drawn-width proof asserts the REAL semantic: auto ⇒
  the renderer's width (140/flex), manual ⇒ the engine's stored width —
  never a content-fit claim. Mutation checks on each: a toggle wired to
  the wrong column id or inverted must fail.
- **Docs:** tool-panel page — resizing (with the css-override interplay
  note, A5) and the auto-width pair (B6); configuration table gains the
  width trio; handle docs gain `setColumnAutoWidth`; api reports
  regenerate (build before api); docs guards satisfied honestly.
- **Changesets:** `@pretable/react` minor (config + handle), `@pretable/ui`
  patch (css).
- The Task 1 jsdom test header's "content-tracking mode" phrase is
  corrected to the mode-bit wording (it currently repeats the myth its
  own body debunks).
- Assert the old behavior survives: header column-resize, the kebab's pin
  actions, Reset's existing restores, and the three keyboard walks.

## Out of scope

Width persistence beyond the controlled trio; per-section widths; a
resize handle on the rail side; min/max-width props for the pane
(the bounds are internal); autosize sampling options (padding, header
inclusion — the store has no such knobs and none are invented here);
touching the header column-resize implementation.
