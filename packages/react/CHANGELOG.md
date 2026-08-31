# @pretable/react

## 0.12.1

### Patch Changes

- Preserve row-layout scroll anchoring across controller rebuilds. Grid/DOM ([#543](https://github.com/cacheplane/pretable/pull/543))
  viewport changes now enter the layout controller as explicit inputs, while
  anchor-adjusted controller publications flow back through grid state to the
  real scroll element without re-feeding the stale pre-anchor offset.
- Updated dependencies []:
  - @pretable/core@0.12.1
  - @pretable/ui@0.12.1

## 0.12.0

### Minor Changes

- The tool panel's pane is resizable, and the columns section can hand a column's width back to the grid. ([#539](https://github.com/cacheplane/pretable/pull/539))

  The pane's grid-side edge is now a drag handle with full keyboard parity: a focusable `role="separator"` with live `aria-value*`, arrow keys stepping 16px (direction-aware in RTL), `Home`/`End` to the bounds, and `Enter` or double-click resetting to the default. Width is React chrome state with the surface's controlled/uncontrolled trio — `defaultPaneWidthPx` / `paneWidthPx` / `onPaneWidthChange` on `PretableToolPanelConfig` — clamped everywhere and reported already-clamped. An untouched, uncontrolled pane writes no inline style, so an existing stylesheet override of the pane's width keeps working until someone actually resizes.

  The columns section's row menu gains an "Auto width" toggle (`role="menuitemcheckbox"`, the new `toolPanelAutoWidthLabel` message), and the handle gains `setColumnAutoWidth(columnId, auto)`. Auto width is a mode bit, not a content fit: on, the grid manages the column's width (the renderer's default, or a flex share when the column declares `flex`); sizing the column yourself turns it off; the toggle hands the width back. The resize handle's accessible name is the new `toolPanelResizeLabel` message.

### Patch Changes

- Updated dependencies [[`ac1cbb4`](https://github.com/cacheplane/pretable/commit/ac1cbb41332ab3c25a04dc9c28517b42573732da)]:
  - @pretable/ui@0.12.0
  - @pretable/core@0.12.0

## 0.11.0

### Minor Changes

- Eviction: the focused cell and the selection anchor survive their rows being ([#427](https://github.com/cacheplane/pretable/pull/427))
  released, exactly as a selection range already does — and DOM focus never falls
  to `<body>`.

  **The cursor.** `reconcileIndexedFocus` re-seated to the nearest surviving row
  whenever the focused row was absent. Under eviction that silently moved the
  user's cursor: scroll away, scroll back, and focus had migrated. That rule was
  written when an absent row could only mean a deleted one. It now reads the same
  discriminator the selection does — `resultMeta.window` — through the same
  `provenDeletedRow`:

  | The focused row is…                       | Result                       |
  | ----------------------------------------- | ---------------------------- |
  | **evicted** (absent, outside the window)  | cursor retained              |
  | **deleted or hidden** (absent, inside it) | re-seats to nearest survivor |
  | still loaded                              | unchanged                    |

  **The anchor.** `anchor = ranges[0].start` fired on visibility alone, so an
  evicted anchor migrated to the first range's start. The anchor is the fixed end
  of the _next_ gesture — a shift-click extends straight from that address — so
  for an upward selection (anchor at the range's end) or a cmd-clicked second
  range, the following shift-click extended from the wrong end and deselected what
  the user had. It is now retained when merely evicted and reassigned only on a
  proven deletion.

  **DOM focus.** When the cursor's cell is unmounted — an evicted row, or an
  ordinary scroll past the virtualization window — focus is parked on the grid's
  scroll viewport rather than being dropped to `<body>`, so the keyboard keeps
  working and a screen reader stays inside the grid. The cell takes focus back the
  moment its row is rendered again, and arrow keys resume from there rather than
  from wherever the viewport is parked. Proven in a real browser
  (`apps/bench/tests/eviction.spec.ts`), with a kill switch that strips the window
  and asserts the cursor is lost — jsdom has no opinion about where focus goes
  when its element unmounts.

  Local mode — a grid with no window — is unchanged in every branch.

- Eviction, finished: an arrow key no longer loses an evicted cursor, and one ([#446](https://github.com/cacheplane/pretable/pull/446))
  deleted row no longer takes a whole selection with it.

  **The keyboard.** The cursor survives its row being released — but
  `moveIndexedFocus` reconciled two-argument, so it could not tell an evicted row
  from a deleted one and dropped the cursor on the very next keystroke. That is
  precisely the state a user is in: they scrolled away from the cell, then pressed
  a key. The eviction context is now threaded through the move and through the
  store's `moveFocus`.

  A row-axis move from a cursor whose row is not loaded is **refused** — the
  cursor holds where the user left it — while the column axis still answers,
  because it never needed the row. The alternatives were both worse: jumping to
  the nearest loaded row teleports the cursor across however many rows were
  released, and moving to the adjacent _dataset position_ cannot be expressed at
  all, because a focus ref addresses a cursor by row identity and the engine
  cannot name a row it has never loaded. A positional cursor that requests its own
  row is a real feature and a product decision; it is deliberately not smuggled in
  here.

  **The selection.** Retention was per _range_: reconciliation dropped a range as
  soon as either endpoint was proven deleted, and collapsed it onto the survivor
  when one endpoint was still loaded. So a range whose start was genuinely deleted
  while its end was merely evicted was discarded whole — an 81-row selection
  reporting 0, or 1, with 80 of those rows still loaded and painted.

  The spec states the rule per _row_, and `datasetRowSpan` is what makes that
  expressible: the proven-deleted rows prune and the span around them narrows.

  | The range's endpoints                | Before                      | Now                          |
  | ------------------------------------ | --------------------------- | ---------------------------- |
  | one deleted, one evicted             | dropped whole               | narrows past the deleted row |
  | one deleted, one loaded              | collapsed onto the survivor | narrows past the deleted row |
  | both evicted, neither provable       | kept whole                  | unchanged                    |
  | every row in the span proven deleted | dropped                     | unchanged                    |

  A deletion shifts everything after it down one, so whichever end was removed the
  survivors land on `lo … hi - 1`. The deleted endpoint's _identity_ is replaced
  by the row that now holds the narrowed boundary, so no deleted row id lingers in
  a live selection — where the anchor reassignment would hand it straight back.
  Fail-closed throughout: a range with no readable span, an emptied span, or a
  narrowed boundary that is not loaded is still dropped exactly as before.

  Local mode — a grid with no window — is byte-for-byte unchanged in every branch.

- Eviction: two publicly-reachable correctness fixes, both of which contradicted ([#460](https://github.com/cacheplane/pretable/pull/460))
  what the docs promised.

  **An evicted selection no longer paints rows the reader never selected.**
  `datasetKey` identifies the QUERY, not the population — deliberately, and
  [the docs](/docs/server-data/lifecycle#datasetkey) tell consumers to keep it
  stable while they page within one result. So an insert or a delete made by
  someone else, upstream of a selection whose own rows are unloaded, arrived with
  the key unchanged and silently re-filled the remembered dataset positions with
  different rows. Reproduced through `<PretableSurface>` with the honesty gate
  fully passing: a `row-1..row-8` selection, both endpoints evicted, five rows
  prepended to the same result, and the returning window painted five rows
  selected — four of which had not existed when the user selected — while the
  eight they did choose painted nothing.

  A span now records the population's SIZE alongside its key
  (`PretableIndexedDatasetRowSpan.datasetTotal`, from the exact
  `resultMeta.total.count` the gate already requires), and a mismatch fails closed
  exactly as a key mismatch does: nothing paints from the span, and
  `getCellSelectionSummary()` reports `verified: false` until a window covering
  both endpoints re-measures it. A proven deletion is the one allowance — a total
  short by exactly the rows the engine watched vanish is accounted for, so
  endpoint narrowing still works. What this does **not** catch is a change that
  leaves the size identical; `eviction.mdx` now says so rather than promising
  otherwise.

  `ɵPretableIndexedSelectionWindow.datasetTotal` is required, not optional: the
  gate that builds a window cannot pass without an exact total, so an optional
  field would only be a way to fail open by omission.

  **One closed-gate revision no longer destroys the selection and the cursor.**
  With `resultMeta.total` reporting `{kind: "estimate"}` for a single render — an
  in-flight count query, a backend that stops counting past 10k — or one revision
  of `processing.sort: "engine"`, a window slide dropped every range and emptied
  the cursor irrecoverably. Restoring the exact total brought neither back.
  Uncontrolled consumers only; a controlled one was accidentally immune because
  the `state.selection` echo re-supplied what the engine had discarded.

  A null window was two different situations sharing one representation. The
  engine is now told which: `windowed` says whether the consumer publishes
  `resultMeta.window` at all, independent of any gate, so a windowed grid with no
  window this revision means "I cannot verify", not "those rows were deleted" —
  and it holds the selection and the cursor byte-for-byte instead of asserting a
  deletion it could not have observed. Local mode, where an absent row genuinely
  is a deleted row, is unchanged in every branch and pinned by tests that run the
  same fixture both ways.

  `CreateGridUiCoreOptions.getSelectionWindow` is replaced by `getWindowing`,
  which returns both facts from one read so they cannot describe different
  instants.

- `processing: { sort: "external" }` now suppresses local sorting, the way ([#467](https://github.com/cacheplane/pretable/pull/467))
  `filter: "external"` suppresses local filtering since #447.

  It previously suppressed nothing: the declaration was read in two advisory
  places and the engine went on applying `query.sort`. That left the consumer who
  declared it worse off than one who did not — declaring external sort authority
  silences the partial-window warning and unlocks the full population as
  `aria-rowcount`, while the local re-sort it silences the warning about kept
  running.

  Suppression changes what is APPLIED, never what is REPORTED: `aria-sort`,
  `onQueryChange` and the snapshot's `query` are untouched. A consumer holding a
  complete window who legitimately sorts locally is unaffected — they declare
  `"engine"`, which is the default.

- The surface speaks filter trees: funnels, the column menu, and controlled ([#493](https://github.com/cacheplane/pretable/pull/493))
  state.

  `query.filters` is now an AND/OR tree — each element is either a typed leaf or
  a `{ op, children }` group, and groups nest (see `@pretable/core` for the node
  type, the `isPretableFilterGroup` guard, and the empty-group rule). The
  surface's chrome follows:

  - The **funnel** lights on ANY occurrence of a column, at any depth. A filter
    the user built inside a group still removes their rows, so it still shows as
    a filter on that column. Previously the surface kept a per-column record
    projected out of the query; a group carries no `columnId`, so that record
    would have collapsed every group onto the single key `undefined` and left the
    funnel dark. The record is gone — the surface holds the tree verbatim.
  - The **column filter menu** owns exactly its column's FIRST top-level leaf. It
    hydrates from that leaf (never from one nested in a group), and a commit
    replaces it in its existing slot rather than removing it and appending at the
    end. Every group element passes through by reference: a menu commit cannot
    edit, reorder, or drop a branch it did not author, and clearing a column
    removes only its top-level leaf. Two ordering details change for a
    hand-authored `filters` that carries duplicate top-level leaves for one
    column — nothing the menu can produce: the menu now reads the FIRST of them
    (the per-column record it replaced was last-wins), and a commit collapses
    them to the single leaf it just wrote.
  - **Controlled queries** take the tree shape. A controlled `query.filters`
    containing groups renders funnels and filters rows exactly as the engine
    evaluates it.
  - `LabeledGridSurface`'s `is-filtered` header decoration walks the tree by the
    same "occurrence anywhere" rule.

  `isPretableFilterGroup`, `PretableFilterGroupFor` and `PretableFilterNodeFor`
  are re-exported from `@pretable/react` — a consumer reading `onQueryChange`'s
  `filters` needs the guard to tell leaves from groups.

  Nothing in this entry builds a group on its own — the funnel writes leaves. The
  tool panel's filters section, released alongside it, is the UI that does.

- The surface reads its grouping configuration from the engine, and the grid ([#498](https://github.com/cacheplane/pretable/pull/498))
  handle can write it.

  `PretableSurface`'s `hideGroupedColumns` prop is now the SEED for engine state
  rather than the live value. Ownership moves, but the prop keeps working in both
  directions: a changed prop is written back onto the engine, so a consumer
  driving it declaratively is still obeyed, and omitting it leaves the engine key
  absent rather than `false` — which is what keeps the ON default resolvable
  above grid-core. The drawn column set follows the engine value.

  `PretableReactGrid` gains two methods, released against the `@pretable/core`
  state they write:

  - **`setHideGroupedColumns(value)`** — moves the drawn set with no prop change.
  - **`setColumnAggregate(columnId, aggregate)`** — overrides the aggregate a
    column's prop declared, or clears the override with `undefined`. The override
    is a LAYER: a column with no override still follows its declared `aggregate`,
    so a consumer who never calls this sees today's behaviour unchanged; an
    overridden column holds what was written; clearing returns it to the declared
    value. Ids are the drawn vocabulary, translated to the row model's schema
    vocabulary and merged into derivations on the way through.

  Two limits on `setColumnAggregate` worth knowing before you offer it to a user.
  It is **rows mode only** — in explicit-model mode the caller owns their row
  model and the hook never re-requests its derivations, so the write is recorded
  in engine state and changes nothing a group row shows; state the aggregate on
  the model's own columns instead. And an **invalid aggregate destroys the grid**,
  not just the write: it surfaces as a render-time `CompiledQueryValidationError`
  inside the commit the write schedules, which unmounts the tree (or empties the
  subtree, under an error boundary) with no recovery short of a remount. A UI
  offering free-form aggregates must validate before calling.

- Modernize the public package build architecture and support both React 18 and ([#537](https://github.com/cacheplane/pretable/pull/537))
  React 19. All public packages retain first-class ESM and CommonJS package-name
  imports, with an explicit ES2018 syntax and runtime API compatibility contract.
  Generated filenames and private `dist` paths are not stable or supported; use
  the documented package root and exported subpaths.

- `PageUp` / `PageDown` go through the engine, so an evicted cursor holds instead ([#453](https://github.com/cacheplane/pretable/pull/453))
  of being teleported.

  The grid's page keys were the last place the surface still resolved a movement
  itself. `handleSurfaceKeyDown` asked the LOADED snapshot for the cursor's index
  and read `indexOf`'s `-1` as "base the step at row 0" — a sentinel that means
  two unrelated things. It means "the cursor is on the header, or there is none",
  where basing at row 0 is deliberate; and it means "this ref did not resolve",
  which is exactly what an **evicted** cursor returns. The two collapsed into one
  branch, so a page key pressed while the cursor's row was released teleported it
  a page into the loaded window — across however many rows had been let go — and
  `Shift+PageDown` dragged the user's selection along with it, into a range with
  no dataset span left to count.

  The branch now calls `moveFocus`, which already models `page-up` / `page-down`,
  already receives the loaded window, and already refuses a row-axis move from a
  cursor it cannot place. That is the same rule an arrow key follows, reached
  through the same code, rather than a second implementation that has to remember
  it. The surface still measures the step — a page is a screen's worth of the body
  viewport, in rendered rows, which the engine cannot know — and hands it over on
  every press.

  A refused move now leaves the **selection** alone as well as the cursor. There
  is nothing new to extend to, and extending to the evicted cursor itself rewrote
  whatever range the user had into `anchor → a row the grid cannot place`: on
  screen, a keystroke that appeared to do nothing while quietly discarding the
  span the selection is counted by. This applies to `Shift+Arrow` as well, which
  had the same hole.

  Three smaller behaviours change with the delegation, all of them the engine's
  existing answer replacing the surface's divergent one:

  - `PageDown` **from a column header** lands on row 0. It used to land a page
    below row 0, which no other key did — `ArrowDown` from the header has always
    meant "the row below the header".
  - `PageUp` **from a column header** holds on the header. It used to drop the
    cursor into the body, where `ArrowUp` there is a no-op.
  - `PageDown` **with no cursor at all** seeds one at the first cell rather than a
    page into the grid, and never on the row-checkbox column.

  Local mode — no `resultMeta.window` — is otherwise unchanged: with no window
  nothing is ever retained, so no cursor can reach the refusal, and the page step
  is measured and applied exactly as before.

- Tool panel: a rail-and-pane shell on `PretableSurface`, on by default, opening ([#486](https://github.com/cacheplane/pretable/pull/486))
  with a columns section.

  The rail is a strip of section tabs docked at the grid's right edge, inside the
  card; selecting a tab opens a 264px pane between the body viewport and the
  rail. The rail borrows the header's surface and the pane the toolbar's, so the
  panel reads as chrome, not content. It ships enabled — `toolPanel={false}`
  removes it — and `PretableToolPanelConfig` drives the open section either way:
  `activeSection`/`onActiveSectionChange` controlled, `defaultActiveSection`
  uncontrolled. The `<Pretable>` preset passes the prop through, which retires
  its documented "no configuration UI" limitation.

  The columns section lists every column, subgrouped by pin state: a checkbox
  toggles visibility (the engine's new `hidden` flag and `setColumnVisible`,
  released alongside in `@pretable/core`, so width, pin state and relative order
  survive a round trip), a search box filters the list, "Reset columns" restores
  the mount-time configuration, and a per-row kebab menu offers the three pin
  placements. Rows reorder by dragging the grip or with Shift+ArrowUp/Down on it;
  Escape abandons an in-flight drag or keyboard move without touching the engine.

  In `@pretable/ui`, the card chrome — border, radius, shadow — moves up from the
  scroll viewport onto a layout wrapper that encloses viewport, pane and rail, so
  the docked panel sits inside the card rather than bolted onto it; the boxes
  inside surrender their own copies and meet at hairlines. A grid rendered
  without the panel paints identically to before.

- Consumer-composable tool-panel sections: `toolPanel.sections` states the ([#514](https://github.com/cacheplane/pretable/pull/514))
  complete rail.

  `PretableToolPanelConfig` gains `sections` — an ordered roster mixing built-in
  section ids (`"columns"`, `"filters"`, `"grouping"`) with custom sections
  authored as the new public `PretableToolPanelSection` descriptor (`id`, `icon`,
  `label`, `render`). One array subsumes appending a pane, hiding a built-in,
  reordering the tabs, and interleaving; absent, the rail is the three built-ins
  exactly as before, and `[]` turns the panel off. The active-section fields
  (`defaultActiveSection`, `activeSection`, `onActiveSectionChange`) widen to the
  new `PretableToolPanelSectionId` (`ToolPanelSectionId | (string & {})`) so a
  custom id is nameable everywhere a built-in's is, without losing autocomplete.

  An invalid roster — a duplicate, empty, or whitespace id, an unknown built-in
  reference, or a custom descriptor reusing a built-in id — throws at render
  with a `[pretable] toolPanel.sections:` message naming the id and the rule.
  An `activeSection` naming an id the roster does not carry renders the rail
  alone without throwing. Custom panes inherit the shell's a11y contract
  (tabpanel semantics, Escape-to-rail, one rail Tab stop); a section that needs
  the grid reaches it through the existing `onGridReady` handle.

- Tool panel: a filters section on the rail, building the query's AND/OR tree. ([#494](https://github.com/cacheplane/pretable/pull/494))

  `ToolPanelSectionId` widens to `"columns" | "filters"`, and the rail grows a
  second tab. The pane it opens is a filter builder over `query.filters` as the
  engine holds it — leaves, groups, and nesting — rather than the per-column view
  the header funnel offers:

  - A row per leaf: column, operator, and a value control typed off the column
    (`text`, `number`, `date`, a checklist for enums and booleans). The operator
    vocabulary is the funnel menu's, so the same filter reads identically in both
    places, and a column's `filterOperators` prunes both lists.
  - `+ filter` and `+ group` at every level; the join between siblings is one
    control per run, because a sibling list has exactly one connective.
  - Commits are live — discrete changes at once, a value the user is still typing
    after a short dwell — so there is no Apply button. A row whose operator has no
    operand yet holds its place as an empty group, which constrains nothing: an
    unfinished row never moves the grid.
  - Enum columns that declare no `options` load their choices through the
    surface's distinct-value path, and inherit its incomplete-universe warning
    under external filtering.
  - The section subscribes to the row model itself, so a filter committed
    elsewhere — a header funnel, a controlled `query` — is reflected in the panel
    as it lands.

  Every string the section renders is a message, resolved off the `messages`
  prop like the rest of the grid: `toolPanelFiltersLabel` for the tab,
  `toolPanelAddFilterLabel`/`toolPanelAddGroupLabel` for the add pair,
  `toolPanelFilterWhereLabel`/`toolPanelFilterJoinLabel` and the join's action
  sentence, the control labels, the remove button, and the nesting refusal.

  `@pretable/ui` ships the section's rules — the row grid, the run rail and its
  join control, the nested-group indent, and the refusal styling for a disabled
  add action.

- Tool panel: a grouping section on the rail — the third pane. ([#507](https://github.com/cacheplane/pretable/pull/507))

  `ToolPanelSectionId` widens to `"columns" | "filters" | "grouping"`, and the
  rail grows a third tab. The pane holds four blocks, top to bottom:

  - A **group-by list**: one row per grouping level, in level order — add a
    level from the `+ Add group` menu (any data column not already grouped),
    remove one with its ✕, reorder by dragging the grip or with
    `Shift+ArrowUp`/`Shift+ArrowDown` on it. The list is a pure projection of
    the query's `rowGroups` — the same model the drag-to-group strip writes, so
    the two surfaces never disagree.
  - **Expand all / Collapse all**, disabled while nothing is grouped.
  - A **Hide grouped columns** switch over the engine's `hideGroupedColumns`.
    A consumer who keeps driving the surface prop of the same name after mount
    retains ownership — the prop writes back and clobbers pane writes; one who
    leaves it alone after mount cedes the state to the pane.
  - A per-column **aggregate picker** (rows mode only — in explicit-model mode
    the block is absent, since the caller owns their row model and an override
    would change nothing a group row shows). Options are `Default (…)` — no
    override, showing what the column's prop declares — `None`, and the
    type-valid builtins (number columns: Sum/Average/Min/Max/Count; every other
    type: Count). `None` writes the new `null` override, meaning "show no
    aggregate"; `Default (…)` clears the override entirely, so "no override"
    and "overridden to the same value" never look alike.

  A grouped column also gains a quiet "grouped" marker in the filters section's
  column picker, shown only while the column is not drawn (grouped with
  hide-grouped on) — distinct from the "hidden" marker, which wins when both
  apply.

  Every string the section renders is a message: `toolPanelGroupingLabel` for
  the tab, the group-by labels (`toolPanelGroupByLabel`,
  `toolPanelAddRowGroupLabel`, `toolPanelRemoveGroupLabel`,
  `toolPanelReorderGroupLabel`, `toolPanelNoGroupsMessage`), the expansion pair,
  `toolPanelHideGroupedColumnsLabel`, the aggregate strings
  (`toolPanelAggregatesLabel`, `toolPanelAggregateColumnLabel`, the
  `Default`/`None`/`Custom` options, and the five builtin names), and
  `toolPanelColumnGroupedMarker` for the filters-picker marker.

  `@pretable/ui` ships the section's rules — the group-by rows and their grips,
  the expansion button pair, the switch row, and the aggregates block.

- Windowed spacers are sized from what rows have measured, not from the default ([#465](https://github.com/cacheplane/pretable/pull/465))
  row height.

  A windowed grid reserves the unloaded regions as spacers, and `getWindowSpacers`
  reports those regions as row **counts** — how many rows sit before and after the
  loaded window. The controller turned a count into pixels by multiplying by
  `defaultRowHeight`. Its own comment said so: _"Row counts, not pixel heights."_

  That is the region's real height only on a grid whose rows are all the default
  height. On a grid whose rows wrap it is a systematic understatement of the whole
  scroll extent, by the ratio between a wrapped row and the unwrapped default —
  and the retained-measurement cache, which knows exactly what those rows were
  worth, was never consulted for geometry at all. It is keyed by row identity
  while the spacer arrives as a count, so the two systems had no way to meet.

  The controller now prices a spacer's rows at
  `RowHeightIndex.getMeasuredHeightMean()` — the mean of every height the DOM has
  reported, the retained heights of evicted rows included — falling back to
  `defaultRowHeight` until something has been measured. A grid that has measured
  nothing, and every grid with no window at all, is byte-for-byte unchanged.

  It remains an **estimate**: a count cannot say which rows are out there, so the
  extent tracks the result's size without reproducing its height. The docs
  previously claimed the spacer "reproduces the region's height precisely" where
  retained heights were exact, which the code could not do and now does not claim.
  `eviction.mdx` and `windowing.mdx` say what it actually computes, and that the
  viewport anchor is what absorbs the residual.

  The mean is aggregated structurally — every hash node in the persistent height
  index carries the sum of its values beside the count it already carried — rather
  than threaded as a running total through `measure`, `apply`, retention eviction
  and the cooperative replacement builder, so a copy-on-write rebuild cannot leave
  it stale.

### Patch Changes

- A consumer `grid.setQuery` landing while a chrome query write (filter menu, sort, grouping strip) is still settling is no longer silently reverted by the next chrome write. The consumer's transition supersedes the in-flight chrome one, which left the surface's pending-query record permanently stale; the public handle now takes over that record so subsequent chrome writes build their unnamed axes from the consumer's query. ([#511](https://github.com/cacheplane/pretable/pull/511))

- Data-honesty checks now read every input from one commit, and the engine-sort ([#435](https://github.com/cacheplane/pretable/pull/435))
  rule finally runs.

  **A narrowing query no longer accuses you of a broken total.** `rows` and
  `resultMeta.total` arrive together, but the row model ingests rows in a layout
  effect — after the render that already read the new total. The contiguous-window
  check therefore compared a new total against the previous query's row count:
  filter 480 rows down to 120 and it reported that 120 records "cannot be a
  contiguous window", then settled at the right `aria-rowcount` a render later.
  Because these warnings fire once per page load, that spurious first one
  permanently disarmed the check for the rest of the session — the real defect. In
  rows mode the loaded count now comes from the `rows` the consumer just handed
  over, and the "no total supplied" fallback counts the same records; explicit-model
  mode still reads the model, which has no such skew and whose `rows` prop is an
  empty array rather than an absent one.

  **`processing: { filter: "external", sort: "engine" }` over a partial window now
  warns.** The rule was written, unit-tested, and never called from a render.
  Sorting a server-selected window locally presents the wrong sample under a
  truthful-looking `aria-sort`, and it fires only where that is provable: an exact
  `resultMeta.total` counting more records than the grid holds. Wiring it depended
  on the fix above — the same one-render skew made an ordinary widening query look
  like a partial window.

  Settled behaviour is unchanged: the same counts, the same scope answers, and the
  same warning for a `resultMeta.total` that really is inconsistent with the rows.

- `processing: { filter: "external" }` now stops the engine applying ([#447](https://github.com/cacheplane/pretable/pull/447))
  `query.filters`, without changing anything the grid reports.

  Declaring external filter authority used to change nothing about which rows were
  drawn: the engine went on re-applying the published filters to whatever rows it
  was handed. That is idempotent while the rows and the query agree — the server
  answered the same query, so re-selecting changed nothing — which is why it went
  unnoticed. It stops being idempotent the moment they disagree, and the lifecycle
  guarantees they will: during `dataState.phase === "stale"` the loaded rows answer
  the PREVIOUS query while the grid already holds the NEW one, so the engine
  filtered the old window by the new filter and the reader watched rows vanish and
  return. The same mechanism was reproducible in the `error` phase — same rows,
  same failed request, `contains "fail"` emptying the body while `notContains
"fail"` kept every row.

  Under external authority the consumer owns which records exist, so re-applying
  the query was the grid overruling the authority it had just been told it does not
  have.

  Nothing that is REPORTED moves. The funnel still shows the active filter,
  `onQueryChange` still publishes it, the query in the snapshot is byte-for-byte
  what it was, and `aria-sort` is untouched. A filter naming a column that does not
  exist is still rejected. Only the record selection stops.

  Two consequences worth naming:

  - **Group aggregates fold everything loaded.** With `aggregateFilteredRows`, the
    filtered population under suppression is the whole loaded window, because the
    server already chose it. Groups whose rows all failed the local filter now
    appear with their totals instead of disappearing.
  - **Sort is deliberately unchanged.** `sort: "external"` still lets the engine
    order the rows it was given; only filtering is suppressed.

  Rows mode only. A consumer who supplies their own model through `model=` already
  decides what goes into the query and can omit the filters themselves, so the
  surface never moves that model's authority.

- Stop segmenting graphemes for text that cannot need it. Grapheme-accurate ([#428](https://github.com/cacheplane/pretable/pull/428))
  counting made `prepareText` — which runs per wrapped cell on the row-height
  estimate path — 97% segmentation by cost, charged twice per string: once for
  the whole text and again per token. ASCII cannot form a multi-code-unit
  grapheme cluster, so such text now counts by code-unit length and segments by
  character; CRLF, the sole exception, still takes the segmenter, as does any
  text carrying a character outside ASCII. On the S2 `hypothesis` scroll
  benchmark this returns `scroll_frame_p95_ms` from 31.8/32.4 to 17.2/18.0 —
  four 120Hz ticks per scroll step back to two — with no predicted line count
  and no estimate changed.

- A grouped streaming commit no longer pays a full-set height-index pass for columns that never changed. The synthetic group column's `value` accessor now has a stable identity, so the per-commit `setColumns` recognizes the roster as unchanged instead of taking the columns-reset path (a synchronous full-set `clearEstimates` walk; a full cooperative re-ingest before #522) on every `applyTransaction` under grouping. ([#529](https://github.com/cacheplane/pretable/pull/529))

- A hidden column stays hidden across a grouping round-trip. ([#513](https://github.com/cacheplane/pretable/pull/513))

  Engine-owned per-column layout state — visibility from `setColumnVisible`, a
  resize from `setColumnWidth`, a pin from `setColumnPinned` — used to be
  silently discarded whenever the drawn roster changed (grouping removing a
  grouped-away column, ungrouping restoring it, a synthetic column mounting):
  the surface rebuilt the engine's column layout from prop-derived values. Now
  the rebuild carries the live engine entry for columns still in the roster and
  remembers the last engine entry for columns that leave it, so a column that
  re-enters — hide-grouped switched off, or the grouping level removed — comes
  back exactly as the user left it.

- Stop recomputing the estimator's line count on every measurement. The row ([#432](https://github.com/cacheplane/pretable/pull/432))
  layout controller asks `predictRowLineCount` to classify each measured data row
  for the height calibration, and the estimator had already computed that number
  for the same row from the same inputs — so the calibration path re-prepared and
  re-laid out every wrapped cell in the grid once per commit. The count is now
  stored on the estimate's existing cache entry and read back. Measured on the S2
  `hypothesis` scroll benchmark, time under `predictRowLineCount` falls from
  17.3ms (3.27% of the run) to 1.1ms (0.22%). No estimate, line count or rendered
  row count changes.

- A streaming commit on a grid with `rowSelectionColumn` no longer pays a full-set height-index pass for columns that never changed. The synthetic row-select column's `value` accessor now has a stable identity (the same hoisted constant the group column adopted in #529), so the per-commit `setColumns` recognizes the roster as unchanged instead of taking the columns-reset path (a synchronous full-set `clearEstimates` walk; a full cooperative re-ingest before #522) on every `applyTransaction`. ([#533](https://github.com/cacheplane/pretable/pull/533))

- The server-controlled data surface is no longer marked experimental. External ([#426](https://github.com/cacheplane/pretable/pull/426))
  filter/sort authority (`PretableProcessingAuthority`, `PretableProcessingOptions`),
  the `dataState` lifecycle (`PretableDataState`, `PretableBodyStateKind`) and
  result metadata (`PretableMatchingTotal`, `PretableResultMeta`) shipped across
  five releases, are locked behind the API-surface gate and carry e2e coverage, so
  the `@experimental` hedge on their TSDoc has been dropped. Their types and
  behavior are unchanged.

- `telemetry.windowGap` now judges the viewport against geometry from a single ([#445](https://github.com/cacheplane/pretable/pull/445))
  commit, which fixes a false negative and a false positive that had the same
  cause.

  **The boundary is the plan's, not arithmetic over it.** The end of the loaded
  window was reconstructed as `totalHeight - trailingRows * rowHeight`: a pixel
  total published by the last row layout plan, minus a row count derived fresh
  from `resultMeta` every render. The row layout controller does not replan on a
  `resultMeta`-only change, so those two halves could describe different states of
  the world. A `total` that GREW pushed the boundary further away and hid the
  defect; a `total` that SHRANK moved it the other way, and `windowGap` went
  silently absent for a viewport still genuinely past the loaded rows — until any
  scroll or row change triggered a replan. The plan already publishes both honest
  halves of that boundary (`leadingHeight` and the loaded rows' own height), so
  the judgement now reads them directly and reconstructs nothing. When the plan is
  current the two expressions are the same number by construction, so no answer
  that was already correct has changed.

  **No gap is reported while the layout does not describe the rows.** At mount
  there is no geometry — the boundary sits at pixel 0 — so every viewport, on a
  grid nobody had scrolled, read as past its own window. That covers three states
  that all publish `totalHeight: 0`: before the first plan, a first block of rows
  landing against the plan for an empty grid, and the render where `rows` have
  been handed over but the row model has not ingested them yet. A gap is now
  reported only once the plan, the row model and the rows you supplied agree on
  how many records are loaded. On the windowing docs example, mount went from four
  requests to one — the example's own.

  Absence of a gap has always meant "no signal" rather than "the viewport is
  inside the window", and that is unchanged: a handler that can tell from its own
  state that the reader is past the loaded block should still act on what it
  knows.

- Updated dependencies [[`693f01e`](https://github.com/cacheplane/pretable/commit/693f01ed15580ec5313186496d2d247d27a24877), [`762bcb0`](https://github.com/cacheplane/pretable/commit/762bcb04354dea5117904ab0cc13839c4fe5633a), [`076a36f`](https://github.com/cacheplane/pretable/commit/076a36fb10a0e304f4dc567d6230f764aea7ab15), [`2a4cd7a`](https://github.com/cacheplane/pretable/commit/2a4cd7a7bdc9d173a3ece006ae9a05271a013b4c), [`305f8f4`](https://github.com/cacheplane/pretable/commit/305f8f4e123d7f423e14ba1dea1697ad9cd2e5a3), [`3124591`](https://github.com/cacheplane/pretable/commit/31245910a77efbeb03aa36db174c92ec23154ef9), [`0eb5236`](https://github.com/cacheplane/pretable/commit/0eb5236fda9a1eec8872a260b52ef08eb1485fcd), [`a29298a`](https://github.com/cacheplane/pretable/commit/a29298a048868d089e6aa376cbeac142b6a2400a), [`ab87c43`](https://github.com/cacheplane/pretable/commit/ab87c43c58ae7c00365379f8c6e896450deabcef), [`f37fa1c`](https://github.com/cacheplane/pretable/commit/f37fa1caa7baa2cd9c00ffd42168bb58621be1b0), [`693f01e`](https://github.com/cacheplane/pretable/commit/693f01ed15580ec5313186496d2d247d27a24877), [`75d3251`](https://github.com/cacheplane/pretable/commit/75d3251e425c1bacc9c2b1ef9db3a0d42ee8459d), [`9e163bf`](https://github.com/cacheplane/pretable/commit/9e163bf3d941247f05204a86c75c1bbdada223f7), [`01a7d60`](https://github.com/cacheplane/pretable/commit/01a7d6044ee3fba6aa47098930a87d4987ea7293)]:
  - @pretable/core@0.11.0
  - @pretable/ui@0.11.0

## 0.10.0

### Minor Changes

- Windowed grids at a nonzero dataset offset are on screen again. ([#422](https://github.com/cacheplane/pretable/pull/422))

  A grid serving `resultMeta.window.start = 5000` rendered **blank** and reported
  **zero visible rows** in telemetry. Its 50 loaded rows were drawn at
  `top: 240000px` — correct, for a 10,000-row extent — while the layout
  controller clamped its own `scrollTop` to the _loaded_ rows' ~2,000px height
  against a ~480,000px content div. No scroll position lined the two up. At
  `window.start = 0` the two coordinate systems coincide, which is why this shipped.

  **The fix: the row-layout controller now publishes one coordinate system.**
  `state.scrollTop` and `state.viewport.scrollTop` are GLOBAL — measured from the
  top of the whole dataset, leading spacer included — the same space every
  published row `top`, `state.totalHeight` and the DOM scroller's own `scrollTop`
  already lived in. Consumers compare those values against each other constantly,
  and a snapshot that mixed the two was not something a caller could use correctly.

  Also fixed, from the same cause: `grid.scrollToRow()` and keyboard
  scroll-into-view both fed a loaded-window-LOCAL row offset straight to the
  scroller, so on a windowed grid they jumped to the top of the dataset instead of
  to the row.

  **Contract change for direct consumers of the internal renderer.**
  `PretableIndexedRenderSnapshot` gains `leadingHeight` — the distance between the
  loaded window's local origin (which `rowMetrics` still uses, because a
  `RowHeightIndex` only knows loaded rows) and the global one everything else uses.
  It is `0` on every non-windowed grid.

  Nothing in the public `@pretable/react` telemetry surface changes meaning:
  `onTelemetryChange` computes `visibleRowCount` / `visibleRowRange` from the
  scroller's own offset, which was always global. Those numbers were simply wrong
  for a windowed grid and are now right. Shipped as **minor** rather than patch
  because `PretableIndexedRenderSnapshot` grew a required field, not because
  telemetry's meaning moved.

  **Known gaps, deliberately not closed here.** `windowGap` telemetry still
  re-derives the spacer as `leadingRows * getThemeRowHeight()` rather than reading
  the published `leadingHeight`; same number today, but read at a different moment,
  so a density change between plan and render would desynchronize it. Nothing
  exercises the window's bottom edge or the trailing spacer.

### Patch Changes

- Updated dependencies []:
  - @pretable/core@0.10.0
  - @pretable/ui@0.10.0

## 0.9.0

### Minor Changes

- Eviction: a cell selection survives its rows being released. Under a ([#412](https://github.com/cacheplane/pretable/pull/412))
  server-controlled window, an absent row _outside_ the loaded span is now
  evicted rather than deleted — it keeps its selection, its height and its
  scroll position, and comes back selected when the window returns.

  This is the combination AG Grid's docs forbid. `maxBlocksInCache` cannot be
  combined with dynamic row heights there, and MUI documents no eviction at all.
  It works here because `resultMeta.window` already tells the engine the loaded
  span, so absence is not ambiguous: outside the window it is eviction, inside it
  is deletion, and deletion prunes exactly as before.

  **What a selection is, when its rows are gone.** A range named by two row IDs
  stops meaning anything once those rows are unloaded — an ID cannot be resolved
  to a position without the row. So a range now also carries `datasetRowSpan`,
  the absolute dataset positions of its endpoints:

  ```ts
  interface PretableIndexedDatasetRowSpan {
    readonly start: number;
    readonly end: number;
    readonly datasetKey?: string;
  }
  ```

  Count becomes `Σ(end − start + 1)` over spans — 4,901 rows reported off 30
  loaded, O(ranges) rather than O(selected rows) — and membership becomes
  containment on a rendered row's dataset position. Neither loads a row. It also
  fixes a retained range painting _nothing_, including for the loaded rows in the
  middle of its own span.

  **The number comes with a qualifier.** `grid.getCellSelectionSummary()` returns
  `{ rowCount, verified }`. A row deleted server-side while it was evicted cannot
  be detected — the engine would need a positional delete or a dataset version it
  does not have — so such a span keeps its count and drops `verified` to `false`.
  Reporting only the loaded rows would understate a genuine 4,901-row selection
  by 99%; reporting the span silently as fact would let a deleted row inflate the
  total forever. Keep the number, refuse the claim. Same shape as
  `PretableMatchingTotal`'s `"exact" | "estimate"`: the qualifier rides with the
  number, and the boundary that must speak a bare integer is the one that
  downgrades.

  **Breaking: a span is now part of a range's identity.** Two ranges over the same
  row IDs with different spans select different numbers of rows, so `sameSelection`
  no longer calls them equal. An evicted endpoint no longer collapses its range to
  the survivor either — that was the ordinary scrolling case, and it silently
  turned an 81-row selection into 1 while reporting `verified: true`. Collapse now
  requires proof of deletion. If you round-trip `state.selection` through your own
  storage, carry `datasetRowSpan` with it; the flat `PretableCellRange` gained the
  field for exactly that.

  **Breaking: `datasetKey` fails closed.** A windowed grid that publishes
  `resultMeta.window` but no `resultMeta.datasetKey` now records and reads back no
  spans at all, and selections degrade to the loaded window as they did before this
  release. That was the previously-default configuration and it was unsafe: with no
  key the engine cannot tell a scroll from a re-sort, and a re-sort refills the same
  dataset positions with different rows. Containment answers a bare boolean with no
  `verified` channel to downgrade through, so a stale span there is not a shaky
  number — it paints the wrong rows.

  **So: publish a `datasetKey` that changes whenever the query or sort order does.**
  Without one you are silently opted out of everything above, which is why
  `@pretable/react` warns once in development rather than degrading quietly.

  Local mode is untouched, byte-for-byte. With no window there are no dataset
  positions to record, so nothing is stamped and nothing is read back.

  Two things this deliberately does **not** do. It ships no evictor — it makes
  releasing rows _safe_, and a consumer shrinking its window is the trigger, which
  the windowed-data contract already allows. And select-all still means the loaded
  window: a cell range is identified by two endpoint row IDs and the engine cannot
  name a row it has never loaded. "All rows" is already expressible in the separate
  sparse row-selection program the checkbox column drives.

### Patch Changes

- Updated dependencies [[`6b98562`](https://github.com/cacheplane/pretable/commit/6b98562e5820d7ba25b1323131b761bb7113929f)]:
  - @pretable/core@0.9.0
  - @pretable/ui@0.9.0

## 0.8.0

### Minor Changes

- Make the row-checkbox slice controllable: `state.rowSelection`, ([#409](https://github.com/cacheplane/pretable/pull/409))
  `grid.setRowSelection()`, and a `PretableRowSelectionState` shape that stays
  sparse.

  Every UI slice could be driven from outside except this one. `query`,
  `selection`, `focus` and the column layout all had a controlled prop; the
  checked set could only be READ, through `onRowSelectionChange` and the grid
  handle. So there was no restoring a saved selection, no "tick everything
  matching this filter", and no undo — and the docs said as much: "There is no
  `state.rowSelection` counterpart in v1."

  `setSelection` looks like it should already do the job and cannot. It takes the
  engine's own containers — a `ReadonlySet` and an opaque normalized interval
  index — which a consumer has no way to construct, and the surface's controlled
  write-back deliberately carried the engine's `rows` through untouched.

  The new public shape is the engine's union with the containers a consumer can
  actually write:

  ```ts
  type PretableRowSelectionState<TRowId> =
    | {
        kind: "explicit";
        rowIds: readonly TRowId[];
        ranges?: readonly PretableIndexedRowRange<TRowId>[];
        excludedRowIds?: readonly TRowId[];
      }
    | { kind: "all"; excludedRowIds?: readonly TRowId[] };
  ```

  Sparseness is the whole point of not flattening this to a list of ids.
  `{ kind: "all" }` is symbolic: applying it visits none of the population, so
  select-all over half a million rows is the same work as over five.
  `ranges` carries a shift-checked span as its two endpoints. `excludedRowIds` is
  points rather than spans, because points are what the engine can store — a
  span-shaped exclusion would read as though it could untick a range.
  `describeRowSelection()` converts the engine's value back to this shape, so a
  symbolic selection can be saved and restored without ever being resolved.

  Two behaviours worth reading before using it:

  - The slice is applied when its VALUE changes, not on every render.
    `onRowSelectionChange` fires from an effect rather than from the click, so for
    one commit the controlled value is a generation behind the grid; re-asserting
    it there would untick the row the user just ticked, and the callback would
    then report the untick instead of the tick.
  - It is resolved against the rows the grid currently shows — ids it cannot see
    are dropped, exactly as ticking them by hand would be — and re-applied when
    the row model publishes, so a streaming grid ends up with what was asked for
    rather than with what it meant at mount.

  Also fixes a pre-existing report: ticking a row and then clicking the header
  select-all fired `onRowSelectionChange([])`, because a symbolic selection
  materializes as an empty list. The header checkbox was already documented as
  silent; it is now silent for the whole time the selection stays symbolic, and
  reports again as soon as it becomes an explicit list.

### Patch Changes

- Updated dependencies [[`f37273d`](https://github.com/cacheplane/pretable/commit/f37273d548e644cfd9bc3cfdc009b8f15fd0c300)]:
  - @pretable/core@0.8.0
  - @pretable/ui@0.8.0

## 0.7.0

### Minor Changes

- Wire CSV export into `<PretableSurface>`. ([#368](https://github.com/cacheplane/pretable/pull/368))

  Three props mirroring the clipboard trio — `csvOptions`, `onExport` (return
  `null` to cancel) and `saveFile` — plus `exportCsv(options?)` on the grid handle
  `onGridReady` hands you, since this grid has no toolbar and the trigger belongs
  to the consumer's own button.

  `exportCsv` resolves columns from the DRAWN order, passes the scope
  `resolveDataScope` computed, and announces through the live region — including
  when the file is partial, which the announcement says out loud rather than
  leaving to `omissions`.

  `onlySelected` and `rowIds` are refused together. They are two ways to name the
  same row set, and merging one over the other made the caller's explicit set
  vanish with nothing said.

  Also fixes two defects on the **clipboard** path, which is where this code's
  shape was copied from and carried both faults verbatim: a `copyToClipboard`
  that threw synchronously escaped the failure branch entirely, and a
  `copyAnnouncement` that threw was reported as a failed copy. The clipboard
  write stays in the keystroke's own task — `writeText` is transient-activation
  gated, so deferring it even one microtask would put it outside the gesture that
  earned the permission.

- `PretableCsvOptions` is now generic in the grid's row-id type, so `rowIds` is ([#371](https://github.com/cacheplane/pretable/pull/371))
  checked against it rather than against the `PretableRowId` union.

  The union is `string | number`, so a `Set<number>` on a string-id grid used to
  type-check, match nothing, and produce a header-only file — a mistyped id
  silently emptying the export. `TRowId` defaults to the union, so every use that
  does not touch `rowIds` is unaffected.

- Add `defaultSaveFile`, `toCsvBlob` and `buildExportFileName` — the delivery half ([#357](https://github.com/cacheplane/pretable/pull/357))
  of CSV export.

  Blob + `<a download>`, chosen over `showSaveFilePicker` for one decisive reason:
  `<a download>` has no user-activation requirement, so it still works after an
  `await`, while the picker is transient-activation-gated and throws
  `SecurityError` once any async work has happened. Chrome's own guidance is to
  open the picker _before_ doing the work, which would make the user name a file
  before knowing whether the export succeeded.

  `buildExportFileName` is pure and sanitizes for the union of all three
  platforms, because everything the browser would otherwise do to a name is lossy,
  silent, and differs by OS — Chromium replaces `:` with `_` on _every_ platform,
  strips leading dots, and diverges between Windows and POSIX on trailing dots.

  An incomplete export is marked in the **filename** (`-PARTIAL`). The signal
  cannot go in the file: RFC 4180 has no comment syntax, so a marker row is a data
  row. A filename travels with the artifact when it is emailed onward and costs
  the bytes nothing.

- Add `serializeCsv`, the pure CSV serializer behind file export. ([#357](https://github.com/cacheplane/pretable/pull/357))

  It reuses the clipboard's value pipeline — the same `formatDataCellValue`,
  `formatAggregateValue` and number-formatter registry — so a CSV agrees with the
  screen, and it resolves columns against the **drawn** order rather than the
  `columns` prop, so reordering and pinning are reflected in the file.

  Two decisions worth knowing:

  - **Formula escaping is on by default and vouches on the RUNTIME VALUE**, not on
    the leading character and not on `column.type`. Escaping from the first
    character corrupts negative numbers — a shipped bug in Jira (`-1000` exported
    as `'-1000` across 9.9.0–9.12.2), in MUI X today, and in CsvHelper. Gating on
    the declared type instead has the opposite failure: `PretableRow` is
    `Record<string, unknown>`, so a string from an API sits happily in a
    `type: "number"` column and its formula ships unescaped. Exempting genuine
    numbers, bigints, booleans and Dates by their JavaScript type keeps the
    anti-Jira property while closing that hole.
  - **The file reports WHY it is incomplete, not merely that it is.** `omissions`
    is a discriminated union — `unloaded-rows` carries the scope that proved it,
    `collapsed-groups` carries the expansion override count — and `complete` is
    derived from it rather than maintained beside it. A boolean was the wrong
    shape: "is this complete" is an open question, and the flag grew a term per
    review round. A union closes it differently — a new reason is a new variant,
    so an exhaustive consumer gets a compile error rather than a silently wrong
    `true`. The shape is borrowed from `@hashbrownai/core`'s frame union. The marker is
    deliberately not written into the CSV: RFC 4180 has no comment syntax, so a
    marker row is a data row, and trading a silent short file for a silently
    corrupted one is not an improvement.

  `scope` is a **required** argument, not an optional one. Defaulting it to
  `"all"` would have made the honesty reporting opt-in: a caller who simply forgot
  it would get a confidently-labelled complete file over a partial window, which
  is the behaviour this exists to refuse.

- Add `PretableSelectionFor<TColumns>`, `PretableCellRangeFor<TColumns>`, and ([#379](https://github.com/cacheplane/pretable/pull/379))
  `PretableCellAddressFor<TColumns>` — the selection-state analogue of
  `PretableQueryFor<TColumns>` from `@pretable/core`, for hand-declaring
  controlled `useState<PretableSelectionFor<typeof columns>>` selection state
  against a `createColumnHelper` + `as const` column tuple.

  **Breaking:** `PretableSurfaceCellAddress<TRowId, TColumns>`,
  `PretableSurfaceCellRange<TRowId, TColumns>`, and
  `PretableSurfaceSelectionState<TRowId, TColumns>` are renamed to
  `PretableCellAddressFor<TColumns, TRowId>`, `PretableCellRangeFor<TColumns, TRowId>`,
  and `PretableSelectionFor<TColumns, TRowId>` respectively — `TColumns` now
  comes first, matching the rest of the `XFor<TColumns>` family, with `TRowId`
  a defaulted second parameter. Update any import of the old names and swap the
  type argument order.

- `<Pretable>` now accepts server-controlled data: `processing`, `resultMeta`, `dataState` and `onQueryChange`, forwarded to `PretableSurface`. Previously these were reachable only from `<PretableSurface>`, so a consumer following the documented entry point had to switch components the moment a server applied their filtering. ([#374](https://github.com/cacheplane/pretable/pull/374))

  The blocker was at the type level rather than in prop forwarding: the query union had no arm for an uncontrolled query _with_ change notification, so a component that never exposes `query` could not report that the query had changed. The uncontrolled arm now makes `onQueryChange` optional rather than forbidden. `PretableControlledQueryOptions` is renamed `PretableQueryOptions`, with no alias kept.

- Add `useDisposeOnUnmount`, a StrictMode-safe way to release a row model you own. ([#385](https://github.com/cacheplane/pretable/pull/385))

  A model you create is yours to dispose, and the obvious way is wrong in development: React StrictMode mounts, unmounts and remounts every component, and `useState` hands the same instance back to the remount — so `useEffect(() => () => rowModel.dispose(), [rowModel])` destroys a model the component is about to keep using. The grid then reports a disposed row-layout controller out of a layout effect and renders nothing at all, in dev only, on every app with `reactStrictMode` on.

  The hook defers disposal by a microtask so the remount can cancel it, and releases the resource on a real unmount. It is the same shape `usePretable` already uses for the models it owns; it exists so consumers do not have to know that.

- Windowed data: `resultMeta.window` positions a contiguous run of rows inside a larger population, and the grid keeps the scroll extent and `aria-rowindex` honest about where that window sits. Regions outside the window are pure geometry — no placeholder or skeleton rows are created, so nothing occupies an `aria-rowindex` belonging to a real record. ([#375](https://github.com/cacheplane/pretable/pull/375))

  `PretableSurface` additionally receives a `windowGap` telemetry signal when the viewport passes an edge of the supplied window, so a consumer can fetch the next block without deriving "am I near the end" from a row range and a threshold.

  The window's effects are gated on honesty: a row reports a dataset position, and the extent spans the dataset, only when the grid is also reporting the dataset count. Grouping, engine-applied filtering or sorting, and inexact totals all disable them together, so position, extent and count can never contradict each other.

  This is the addressing layer. Eviction — releasing rows to bound memory while variable row heights stay stable — builds on it.

### Patch Changes

- Row height estimates now account for three things the estimator could not see. ([#373](https://github.com/cacheplane/pretable/pull/373))

  Line height is resolved from the element that actually lays the wrapped text
  out, rather than from the cell. A cell that delegates its text to an inner span
  takes that span's line height; a cell with no such descendant is unchanged.

  A wrapped column's `render` output is measured, once per theme, and charged to
  the wrapped text so the estimate accounts for the horizontal space it occupies.
  This covers the shape where the wrapped text is a direct text node of the layout
  element and the extras beside it are single-line element siblings — a trailing
  chip, a leading icon. Anything else yields nothing and estimates exactly as
  before.

  The line box that render output sits on is measured too. A row's height is
  `(lines − 1) × lineHeight + lastLineBox`, not `lines × lineHeight`: a line box is
  as tall as the tallest thing on it, and a trailing chip is taller than the text
  it sits beside. The line box is measured off the same rendered cell as the width
  — it is not the chip's own height, which the browser splits at the chip's
  baseline — and an unmeasured one charges a plain line, exactly as before.

  None of the three adds a per-estimate DOM read: all resolve through the existing
  per-theme cache and its shared `MutationObserver`.

- Estimate wrapped row heights under the white-space model the browser is ([#384](https://github.com/cacheplane/pretable/pull/384))
  actually running.

  `pretable-surface.tsx` renders every wrapped cell with
  `white-space: pre-wrap`, which preserves runs of whitespace and any whitespace
  at the start of a line. Both of the row-height estimator's paths hardcoded
  `text-core`'s `wrap` for exactly those columns — and `wrap` is
  `white-space: normal`, which collapses a run to a single space and drops a
  leading one entirely. So for any cell value containing consecutive spaces, a
  tab, leading whitespace, or a newline followed by indentation, the estimator
  predicted a wrapping that never happens: it planned the row one or more lines
  short, and the row jumped when the measurement arrived.

  The mode is now resolved from the DOM rather than hardcoded to `pre-wrap`, the
  same way line height, padding and the render advance already are. The surface's
  declaration is an inline style on the CELL, but the element that forms the line
  boxes is frequently a descendant of it, and `white-space` is inherited — so a
  rule on that descendant overrides the cell with no `!important` and no
  specificity contest, and the used value is the only thing that can be trusted.
  It is read once per theme change, off the `getComputedStyle` call the box
  already makes, and only from a cell that declares itself wrapped: adopting the
  `nowrap` of a non-wrapped cell would tell the estimator no wrapped column ever
  takes a second line. A grid with nothing readable keeps the `wrap` it has
  always assumed.

  Tabs remain approximate. CSS advances a tab to the next `tab-size` stop, which
  depends on where the pen already sits, while a canvas reports one flat advance
  for `"\t"` — so a tab run is still under-charged, now by less.

- Row height estimates now read the row box from CSS instead of inferring it. ([#363](https://github.com/cacheplane/pretable/pull/363))

  `getThemeBoxMetrics()` resolves line height, cell padding and rule width off a
  rendered cell and threads them to the estimator. Wrapped text is measured
  against `columnWidth − 2 × paddingX` — the text box — rather than the full
  column, which had been fitting more characters onto a line than a cell can
  hold. Padding is per-theme and per-density (Excel 6/8/12px, Material 16px), so
  on a 320px column this was worth up to 10% of the line.

  The least-squares fit that had been learning "line height" and "chrome" from
  measured rows is removed. It was inferring two numbers the browser reports
  directly, and it had been absorbing the padding error rather than modelling
  anything. The learned floor — what a custom `render` prop contributes, which
  nothing else can observe — is kept.

  Measured against 48 rows captured from a real Chromium session: line-count
  prediction 37/48 → 47/48, mean height error 8.69px → 3.50px.

  An unthemed grid is unchanged: the fallbacks compute to exactly the previous
  constants.

- Re-read the row-height estimator's theme metrics when the theme or density ([#365](https://github.com/cacheplane/pretable/pull/365))
  actually changes.

  The measured character width and the row box (line height, cell padding,
  border) were each read once per session and never again, so a grid that
  switched theme or density kept estimating against the old font and the old
  padding. Both now invalidate on the same signal — the `MutationObserver` on
  `<html>` that `useResolvedHeights` and `useResolvedPx` already subscribe to —
  and re-read on the next estimate rather than on every estimate, so the
  per-estimate path stays free of DOM reads.

- Fixed a regression from notify-only query mode (#374): supplying `onQueryChange` ([#380](https://github.com/cacheplane/pretable/pull/380))
  without `query` — the engine still owns the query and merely reports changes,
  the `<input defaultValue onChange>` shape — silently disabled sorting (and
  filtering, grouping, and any other query-driven interaction).

  `setQuery` decided whether to apply a transition by checking whether an
  `onQueryChange` callback was present, rather than whether the query was
  controlled. Both shapes supply a callback, so the notify-only case took the
  same early return as the controlled case: it reported the new query and
  stopped, never reaching the row model. The consumer's UI kept clicking a sort
  header and nothing happened.

  `usePretable` now tells the engine explicitly whether `query` is controlled.
  Controlled (`query` + `onQueryChange` both supplied) still reports-and-stops —
  the consumer owns the next state. Notify-only (`onQueryChange` alone) now
  reports and applies, matching the uncontrolled case it always claimed to be.

- Learn the row-height floor as a running **mean** rather than a running max. ([#378](https://github.com/cacheplane/pretable/pull/378))

  The floor is the one term of a row's height no stylesheet describes: what a
  custom `render` contributes to rows whose wrapped text does not decide them. It
  accumulated as a max, on the argument that a floor must cover the tallest such
  row.

  That argument was re-examined twice and upheld twice, and both times the answer
  rested on a cancellation: the estimator was systematically under-estimating (43
  of 48 sampled rows short, none long) and a floor biased high by construction was
  offsetting it. #373 fixed the under-estimates, so the question could be answered
  on its own terms for the first time. Re-measured on top of it, over the hero's
  48 rows:

  - **Measured path** (a host with a canvas): both policies compute the same
    63.0px floor, so per-row error and scroll extent are identical to four
    decimals — 0.2876px and −0.3724%. The choice is moot there.
  - **Average path** (no canvas — what SSR and every canvas-less host estimate
    through): the mean wins both objectives at once. 2.2737px per row against the
    max's 3.0245px, and +0.9947% scroll extent against +2.2481%. It previously
    lost both.

  The cost is memo churn: a max stops moving once the tallest admitted row has
  been seen, while a mean shifts on every admitted measurement, and estimates are
  memoized on the calibration object's identity.

- Read the grid's font, letter spacing and sample text off the same cell the row ([#378](https://github.com/cacheplane/pretable/pull/378))
  box is read off.

  `resolveGridTextStyle` kept its own fallback lookup, an unscoped
  `document.querySelector("[data-pretable-cell]")`. The row-select column is
  synthetic and left-pinned, so its cell is the FIRST `[data-pretable-cell]` in
  the document and that fallback always landed on it. It reports a normal cell
  font, which is why it went unnoticed — but it lays out no text, only an 11px
  checkbox button. So on any grid where no cell wraps, the "grid's own text" the
  average character width was measured over was the built-in corpus string rather
  than real content, and the font and letter spacing came off an element that
  lays out nothing.

  The lookup now comes from one shared `findSampleCell`, which prefers a wrapped
  cell and excludes the row-select cell — the same exclusion the row box has had
  since it started resolving line height from the element that lays out the text,
  where sampling the row-select cell would have shipped an 11px line height for
  every grid.

- Wrap estimated row text by real measured segment widths instead of one average ([#367](https://github.com/cacheplane/pretable/pull/367))
  character width. `@pretable-internal/text-core` gains an optional measurer,
  grapheme-accurate counting, CSS `letter-spacing`, and a `white-space: pre-wrap`
  mode; `@pretable/react` supplies a canvas-backed measurer cached by
  `(segment, font)`. Against 48 rows captured from a real Chromium session, line
  counts go 47/48 to 48/48 and mean height error 3.500px to 3.083px. Grids on a
  host that cannot measure — server rendering, no canvas — estimate exactly as
  before.

- Document the boundary between the two selection slices, and drop a dead ([#397](https://github.com/cacheplane/pretable/pull/397))
  notification path that pretended there was only one.

  `PretableSelectionFor` — the type behind `state.selection` and
  `onSelectionChange` — is cell ranges plus an anchor. The `rowSelectionColumn`
  checkboxes are a separate engine slice: a sparse row-selection program that can
  mean "all rows" without listing them, which a set of (start, end) cell addresses
  cannot express. `onRowSelectionChange` is the callback for that slice, and was
  documented nowhere.

  The row-checkbox click handler diffed the cell-range selection before and after
  the toggle and emitted `onSelectionChange` when it changed. Neither
  `toggleRowSelection` nor `selectRowRange` writes `ranges` or `anchor`, so that
  branch could never be reached; it is removed rather than left to imply a
  notification that never arrives. `onSelectionChange` and `onRowSelectionChange`
  now carry TSDoc naming the split, and
  `packages/react/src/__tests__/selection-slice-boundary.test.tsx` pins it in both
  directions.

  No runtime behavior changes.

- Row height estimates no longer over-charge runs of consecutive whitespace. ([#381](https://github.com/cacheplane/pretable/pull/381))

  The estimator predicts a wrapped cell's line count without a DOM, and it charged
  a run of spaces its full width. Browsers under `white-space: normal` collapse
  such a run to a single space — inline `"a  a"` measures 3 character advances,
  not 4, in Chromium, WebKit and Firefox alike — so text with double spaces was
  predicted wider, and therefore taller, than it renders.

  A run of whitespace is now charged one grapheme however long it is, on both of
  the estimator's wrapping paths: the average-character-width path and the
  measured-segment one. A run of tabs collapses with the spaces around it, since
  the tokenizer takes any non-newline whitespace run as a single token. Leading
  runs are still dropped entirely, and `\n` still breaks the line.

  `nowrap` and `pre-wrap` are unaffected. `pre-wrap` preserves runs deliberately —
  that is its measured browser behaviour — and its intrinsic width still counts
  every grapheme.

- Updated dependencies [[`2a4afd1`](https://github.com/cacheplane/pretable/commit/2a4afd1e26f2eb5a3b0c290019c1ff5cfec4aaf5)]:
  - @pretable/core@0.7.0
  - @pretable/ui@0.7.0

## 0.6.2

### Patch Changes

- Measure the grid font's average character width instead of guessing 7px for every font. ([#358](https://github.com/cacheplane/pretable/pull/358))

  The row-height estimator models a font as a single number — pixels per character — and wraps with `charsPerLine = floor(width / averageCharWidth)`. Nothing ever measured that number. `prepareText` inferred it by pattern-matching a font-key string, and the key the estimator passed was the literal `"Pretable Estimate 14"`, which matched none of its patterns. Every pretable grid, in every font, silently estimated at 7px per character.

  React now measures the real value once per font with a single `canvas.measureText` call — no layout, no reflow, nothing inserted into the document — reading the computed font from an already-rendered cell and using that cell's own text as the sample. The result is threaded to the row-layout controller alongside `defaultRowHeight`. The estimator also learns a grid's real chrome and non-text floor from measurements it already takes.

  Measured against 48 real rows captured in Chromium, mean absolute height error falls from 11.52px to 8.69px from the measured width, and to 6.85px with the learned terms applied.

  Line-count prediction regresses in the same change: 43/48 correct at the guessed 7px, 37/48 at the measured 6.505px. The cause is a separate, untouched bug — `predictRowLineCount` wraps at the full column width and never deducts the cell's horizontal padding, over-stating characters per line. The old 7px guess over-stated character width by roughly the same factor, and the two errors cancelled. Measuring honestly removed one half of that accident and exposed the other; the padding bug is filed as a follow-up.

  Where no canvas is available — server rendering, jsdom — the measurement returns `null` and estimates are byte-identical to before.

- Updated dependencies []:
  - @pretable/core@0.6.2
  - @pretable/ui@0.6.2

## 0.6.1

### Patch Changes

- Stop repainting the grid on every slice of a cooperative rebuild. ([#352](https://github.com/cacheplane/pretable/pull/352))

  `setQuery` and `setDerivations` rebuild incrementally, publishing a fresh state object per slice whose `status` carries `completedRows`/`totalRows`, while `snapshot` keeps pointing at the current rows until the new ones swap in. The React model subscribed `useSyncExternalStore` to `getState`, so every progress tick was a new identity and re-rendered the whole grid against rows that had not changed — and because those renders land inside the yield between slices, the rebuild itself paid for them.

  Measured on a 120-row grouping transition: the row model alone settles in 7ms over 10 scheduler hops; the same model under a surface took 89 hops and roughly 470ms. On a 400-row sort, a consumer rendered 20 times where 4 are material.

  The hook now subscribes to the snapshot and to a status coarsened to its kind and transition id. Progress is still published by the row model — subscribe to it directly for a progress indicator — but it no longer forces a render of the grid.

- Updated dependencies []:
  - @pretable/core@0.6.1
  - @pretable/ui@0.6.1

## 0.6.0

### Minor Changes

- Group expansion now defaults to expanded rather than collapsed. ([#350](https://github.com/cacheplane/pretable/pull/350))

  `createLocalRowModel` and `PretableSurface` open groups by default, restoring the behaviour `grid-core` shipped before the incremental row-model migration. Grouping is an interactive act here — a user drags a column into the group panel while reading their rows — and collapsing on drop hid the data they were just looking at.

  Pass `initialExpansion` to choose another policy. `{ kind: "through-depth", depth: 0 }` opens only the top level and is the one to reach for when the grouped population is too large to draw at once.

### Patch Changes

- Updated dependencies [[`65d0365`](https://github.com/cacheplane/pretable/commit/65d0365fdc755903dccbdccc9844cbf4d2eab2d8)]:
  - @pretable/core@0.6.0
  - @pretable/ui@0.6.0

## 0.5.2

### Patch Changes

- Stop re-estimating the height of a row that has already been measured. ([#342](https://github.com/cacheplane/pretable/pull/342))

  When a streaming update replaced a row's data, the row layout controller published a fresh
  `estimateDomRowHeight` value for it — even though the DOM had already reported that row's real
  height. The estimate and the measurement disagree for any wrapped column, so every update swapped
  one for the other and the rows below it jumped. On the homepage hero grid, which streams cell
  updates into a wrapped column, this read as continuous jitter.

  The controller now retains the last measured height per data-row identity and uses it as the
  estimate gate's fallback, so an estimate is only ever used for a row that has never been measured.
  Measured in Chrome against the hero grid, estimator-valued publications over a streaming run
  dropped from 71 to 0.

  Retention is bounded by a new `maxRetainedRowHeights` option and is scoped to data rows; group
  entries are never retained, since the estimate gate that consumes retained heights is itself gated
  on data rows.

- Updated dependencies []:
  - @pretable/core@0.5.2
  - @pretable/ui@0.5.2

## 0.5.1

### Patch Changes

- Fix a WebKit-only stall that left large grids blank for hundreds of milliseconds after mount. ([#343](https://github.com/cacheplane/pretable/pull/343))

  The row-layout controller yields between build slices, and its fallback scheduled each continuation with `setTimeout(task, 0)`. Because every slice schedules the next from inside the previous one, those are nested zero-delay timers, which browsers clamp to ~4ms — pure latency, paid per slice, while the grid shows nothing. Safari ships no `scheduler.postTask`, so it always took that path.

  Measured on a 2,500 × 500 grid, mount to first painted cell: WebKit 263ms across 25 timer hops, against 13ms in Chromium; removing `postTask` from Chromium reproduced the stall exactly (176–190ms), so the engine was never the variable. The fallback now prefers an unclamped `MessageChannel` message, the same ladder the row model's cooperative transition already used, and WebKit lands at ~15ms.

- Updated dependencies []:
  - @pretable/core@0.5.1
  - @pretable/ui@0.5.1

## 0.5.0

### Minor Changes

- Release the work merged since 0.4.0. Ten commits landed on `main` without changesets and so were never published; this releases them together. ([#330](https://github.com/cacheplane/pretable/pull/330))

  **Row model (#321)** — the incremental row-model migration completes, changing public surface in `@pretable/core` (grid construction, the local row model, and the exported types).

  **Cell presentations (#318, #319)** — the semantic ramp and the first cell presentations, then badge and entity presentations, added to `@pretable/react`'s public API.

  **Theming (#322)** — `pretable.css` is the house theme and the documented default; Excel and Material become compatibility skins.

  **Fixes (#324, #325)** — a focused cell now draws exactly one ring rather than two, which also restores the pinned-column seam the duplicate ring had been evicting from its `box-shadow` slot; the Material dark checkmark moves from 1.70:1 to 7.73:1 contrast; and the row-height floor follows `--pretable-row-height` instead of a hard-coded 44px, so a themed density change is honored by measured and estimated rows alike.

### Patch Changes

- Fix the cell focus ring, which was declared but never painted. Every gridcell rendered with an inline `outline: none` — added years earlier alongside keyboard navigation, when the ring was drawn as an inset `box-shadow` and the user-agent outline needed suppressing. Once the ring became an `outline`, that inline declaration silently erased it: an inline style beats a `@layer` + `:where()` rule at any specificity. `outline-offset` kept applying, so the rule still looked live while nothing was drawn, and a focused cell showed no focus indicator in any consuming app. ([#333](https://github.com/cacheplane/pretable/pull/333))

- Updated dependencies [[`a7ce60a`](https://github.com/cacheplane/pretable/commit/a7ce60a7d90f4107f7e2af91326dceea5b1e023c)]:
  - @pretable/core@0.5.0
  - @pretable/ui@0.5.0

## 0.4.0

### Minor Changes

- Add opt-in native number formatting with locale-aware money and accounting presets, aggregate inheritance, and matching clipboard output. ([#317](https://github.com/cacheplane/pretable/pull/317))

- **Breaking:** remove `<InspectionGrid>` and its types (`InspectionGridProps`, `InspectionRow`, `InspectionSeverity`, `InspectionFilterableColumnId`) from `@pretable/react`. ([#303](https://github.com/cacheplane/pretable/pull/303))

  It could not be used. The component hardcoded `columns` to `inspectionColumns` from `@pretable-internal/scenario-data` — a private test-fixture package — so it rendered a fixed seven-field log schema (`timestamp`, `severity`, `source`, `owner`, `tags`, `message`) no matter what you passed to `rows`. There was no prop to change that. Because `tsup` marks `@pretable-internal/*` as `noExternal`, the fixture's column array was bundled into the published tarball.

  Nothing it added was reachable by a consumer. Against `<LabeledGridSurface>`, which it wrapped, it contributed: the fixture columns; a `formatValue` whose body was identical to `<LabeledGridSurface>`'s own default; `getRowId: (row) => row.id`, a positional-identity guess this repo refuses at every other entry point; `selectFocusedRowOnArrowKey`; six hardcoded class names whose only stylesheet lived in the pretable website's `globals.css`, scoped to an `#grid` id no page has had since the playground was removed; and a `data-filterable="true"` attribute nothing in the repo reads.

  **Migration.** Use `<LabeledGridSurface>` and pass your own columns — it takes every prop `<InspectionGrid>` forwarded, plus the ones `<InspectionGrid>` fixed:

  ```tsx
  <LabeledGridSurface<MyRow>
    ariaLabel="Events"
    columns={columns}
    getRowId={(row) => row.id}
    rows={rows}
    selectFocusedRowOnArrowKey
    viewportHeight={460}
    bodyCellClassName="my-cell"
    labelClassName="my-cell-label"
    valueClassName="my-cell-value"
  />
  ```

  `<LabeledGridSurface>` already joins array values with `", "` and stringifies the rest, so the removed `formatValue` needs no replacement.

  `@pretable/react` no longer depends on `@pretable-internal/scenario-data` in any form.

### Patch Changes

- Estimate wrapped row heights at a `flex` column's resolved width. ([#304](https://github.com/cacheplane/pretable/pull/304))

  A wrapped column's height estimate wrapped its text at `widthPx`, or at a fixed fallback when the
  column declared none. That is not the width a `flex` column is drawn at — the drawn width comes from
  distributing the leftover viewport space, and it moves with the viewport, with a sibling column's
  resize, and with a column leaving the drawn set while grouped. So a column declaring both `wrap` and
  `flex` had an estimate that never moved at all.

  Measured in a browser with one `flex: 1` wrapped column beside a 140px fixed one, the estimate held
  at 138px across drawn widths of 1058px, 558px and 318px — text that really occupied one, two and
  three lines. It now tracks the drawn width, so rows that have not been measured yet are placed at a
  height the viewport agrees with. The visible symptoms were scroll-anchor drift and a scrollbar sized
  for content that was not there.

  Only grids with a column declaring both `wrap` and `flex` are affected; every other column resolves
  its width exactly as before.

- Resolve `flex` columns at their drawn width when hit-testing a header drag and when scrolling a column into view. ([#312](https://github.com/cacheplane/pretable/pull/312))

  `planColumnLayout` — the one plan shared by drag-to-reorder hit-testing and keyboard scroll-into-view — resolved every column through the renderer's `widthPx`-or-fallback rule. A `flex` column is not drawn at that width: it is drawn at its share of whatever the fixed columns leave over. Both consumers compare this plan against rendered pixels, so a flex column put every column after it at an offset nothing on screen had.

  Measured in a browser with one `flex: 1` column between fixed ones in a 1000px scrollport, where the flex column is painted 518px wide:

  - dragging a header and parking the cursor inside the next column painted the drop indicator 98px away from the boundary the cursor was over, and the drop landed the column at the far end of the grid instead of where the cursor pointed;
  - with the flex column clamped by `minWidthPx` so the row overflowed, arrowing right to the last column did not scroll at all — the flex-blind plan's `totalWidth` was narrower than the viewport, so the reveal clamped its offset to 0 and the focused cell stayed off screen.

  Both now match the painted geometry. Only grids with a `flex` column are affected; every other column resolves exactly as before, as does any grid whose scrollport has not been measured yet.

- Updated dependencies [[`dccf75e`](https://github.com/cacheplane/pretable/commit/dccf75e4d9cdee0b0b8dd040ba921981c85255d7), [`d257a8f`](https://github.com/cacheplane/pretable/commit/d257a8ffde065aabb4c0e1582f23598a37b734ac)]:
  - @pretable/core@0.4.0
  - @pretable/ui@0.4.0

## 0.3.2

### Patch Changes

- Updated dependencies [[`afdaf45`](https://github.com/cacheplane/pretable/commit/afdaf451d09bb5fd841a70efc15f41b34cf1880b)]:
  - @pretable/ui@0.3.2
  - @pretable/core@0.3.2

## 0.3.1

### Patch Changes

- Replace the grid's glyphs with a first-party stroked icon set. ([#295](https://github.com/cacheplane/pretable/pull/295))

  There was no icon set — there were nine glyph sources across three incompatible rendering systems.
  Two _filled_ SVGs (the filter funnel and the column-menu overflow) authored on a 16 grid but drawn
  at 11px, so every edge landed on a fractional pixel. Six Unicode text characters — the sort arrows,
  the group twisty, the row-select tick, the indeterminate dash, the chip's close — which re-rendered
  in whatever font the active theme picked, so their weight, size and baseline shifted between Excel's
  Aptos Narrow and Material's Roboto and again across platforms. And a CSS `radial-gradient` for the
  chip's grip dots. Nothing could give them a shared stroke weight or optical size.

  They are now nine glyphs on one 16px grid: 1.5px stroke, rounded caps and joins, drawn in
  `currentColor` and sized from a new `--pretable-icon-size` token — 12px under Excel, 16px under
  Material. No icon-library dependency, and nothing added to the public API.

  The one exception is the number editor's stepper arrows, which stay as text. Converting them was
  tried and measured: the editor's height moved 3px, its stepper column widened 3.6px, and the stacked
  buttons overflowed their container by 9px. No smaller size rescues it either — holding that column's
  width needs roughly a 6.4px glyph, whose stroke scales below 1px. The column is dimensioned around
  an 8px text glyph and needs redesigning before an icon fits.

  If you set `--pretable-icon-size` in a custom theme you control every glyph at once. If you do not,
  they fall back to 16px — an SVG with a `viewBox` and no width has no useful intrinsic size, so the
  fallback is load-bearing rather than decorative.

- Updated dependencies [[`6c2d05c`](https://github.com/cacheplane/pretable/commit/6c2d05cfa09032dd4fdfba7ca28d054dcd47df72)]:
  - @pretable/ui@0.3.1
  - @pretable/core@0.3.1

## 0.3.0

### Minor Changes

- **Breaking:** `getRowId` is now required on every entry point, and its `index` ([#293](https://github.com/cacheplane/pretable/pull/293))
  parameter is gone. Row identity is never positional.

  `createGrid`, `usePretable`, `<Pretable>`, `<PretableSurface>` and
  `<LabeledGridSurface>` previously disagreed: `<Pretable>` guessed `row.id` and
  then fell back to the array index, the rest fell through to the engine's
  positional default. Selection, focus, in-flight edits, group expansion and
  `applyTransaction` are all keyed by row id and are designed to survive a
  wholesale row replacement — under a positional id that design silently
  re-pointed them at whichever rows had moved into those positions. No error, no
  warning, wrong rows.

  `getRowId` now takes only the row, so position is not in scope:

  ```diff
  - getRowId?: (row: TRow, index: number) => string;
  + getRowId: (row: TRow) => string;
  ```

  Migration: pass `getRowId` wherever you construct a grid. Rows with no natural
  key need one synthesized when the data is loaded — an index captured at load
  time is stable; an index read at lookup time is not.

  `createGrid` throws when `getRowId` is missing or is not a function, for
  callers TypeScript cannot reach. `applyTransaction`'s narrower version of that
  check is gone: it is now unreachable, and it was already unreachable from React,
  where `usePretable`'s stable wrapper walked an omitted `getRowId` straight past
  it.

### Patch Changes

- Updated dependencies [[`af880e8`](https://github.com/cacheplane/pretable/commit/af880e8996abc55e70b179d5b3e3eb033ab2aad8)]:
  - @pretable/core@0.3.0
  - @pretable/ui@0.3.0

## 0.2.0

### Minor Changes

- Every type `@pretable/react` names in a public signature is now importable from ([#290](https://github.com/cacheplane/pretable/pull/290))
  `@pretable/react`.

  API Extractor had been reporting 23 `ae-forgotten-export` warnings against
  `react.api.md` — types a public signature declares that the entry point does not
  export. They were warnings, so they were generated, committed, and reviewed past.
  `PretableSelectionState`, for one, is the parameter type of `onSelectionChange`
  and of `PretableGrid.setSelection`; a consumer writing either handler could not
  name its parameter without reaching into `@pretable/core`, which no doc page
  tells them to do. The count is now zero, in all four published packages.

  Newly exported:

  - Engine types already public in `@pretable/core`: `AutosizeOptions`,
    `PretableAggregateFormatInput`, `PretableCellAddress`, `PretableCellRange`,
    `PretableFocusState`, `PretableMoveFocusOptions`, `PretableRowRange`,
    `PretableSelectionState`, `PretableSortDirection`, `PretableTransaction`,
    `PretableViewportState`, and the engine's column as `PretableBaseColumn` (this
    package's `PretableColumn` extends it, so it sits in a public `extends`
    clause).
  - Render-snapshot geometry: `PlannedColumn` and `RowMetricsReader`, both members
    of `PretableRenderSnapshot`, which `usePretable` returns.
  - `InspectionGrid`'s row contract — `InspectionRow`, `InspectionSeverity`,
    `InspectionFilterableColumnId` — now declared by this package instead of
    imported from an internal fixture package.
  - Surface hook inputs: `PretableSurfaceRowInput`,
    `PretableSurfaceHeaderCellInput`, `PretableSurfaceHeaderCellRenderInput`.

  Renamed, and collapsed where two names meant one shape:

  - `renderBodyCell`, `getBodyCellClassName` and `getBodyCellProps` now declare
    `PretableCellRenderInput`, which was always what their three separate alias
    names resolved to and was already exported.
  - `getRowClassName` / `getRowProps` take `PretableSurfaceRowInput` (was
    `PretableSurfaceRowClassNameInput` / `PretableSurfaceRowAttributesInput`, two
    identical interfaces).
  - `getHeaderCellClassName` / `getHeaderCellProps` take
    `PretableSurfaceHeaderCellInput` (was `PretableSurfaceHeaderClassNameInput` /
    `PretableSurfaceHeaderAttributesInput`).

  None of those old names were exported, so no consumer could have been importing
  them; the shapes the callbacks receive are unchanged.

### Patch Changes

- Updated dependencies []:
  - @pretable/core@0.2.0
  - @pretable/ui@0.2.0

## 0.1.1

### Patch Changes

- Updated dependencies [[`917fe91`](https://github.com/cacheplane/pretable/commit/917fe916e91edcd2e15ff7444fd25db6e0b100e3)]:
  - @pretable/ui@0.1.1
  - @pretable/core@0.1.1

## 0.1.0

### Minor Changes

- Add server-authority primitives (experimental). ([#286](https://github.com/cacheplane/pretable/pull/286))

  An upstream processor — a server, a worker, a wasm index — can now own
  filtering and sorting while Pretable renders honest counts and an honest data
  lifecycle.

  - `processing: { filter, sort }` on `createGrid` / `PretableSurface` selects
    per-operation processing authority. `"external"` displays the state (funnel
    indicators, header arrows, `snapshot.filters`, `snapshot.sort`) without
    applying it to the loaded records.
  - `setRows(rows, meta)` and `setResultMeta(meta)` accept a `PretableResultMeta`
    of `{ total, datasetKey }`. `snapshot.matchingTotal` reports the matching
    population; a changed `datasetKey` clears selection, focus, group expansion
    and any in-flight edit.
  - `dataState` (no default) turns on lifecycle presentation: loading / empty /
    error body blocks, a `data-pretable-data-phase` styling hook, and result and
    error announcements. `renderBodyState` overrides the built-in blocks.
  - `aria-rowcount` publishes the exact population under full external authority
    with an exact total and no grouping, and downgrades honestly otherwise.
    `aria-busy` is never set on the grid.
  - Select-all, copy, group child counts and `formatAggregate` are scoped
    `"all" | "loaded"` so a partial window can never be described as everything.
  - `column.filterOperators` prunes the funnel menu to operators the processor
    can honor.

  **Breaking:** `PretableGridSnapshot.totalRowCount` and
  `PretableTelemetry.totalRowCount` are renamed to `loadedRowCount`. There is no
  alias — the old name became wrong the moment two totals existed.

  **Also breaking:** four of the new members are required, not optional, so any
  hand-built object of these types stops compiling until it supplies them —
  `matchingTotal` and `datasetKey` on `PretableGridSnapshot`, `matchingTotal` on
  `PretableTelemetry`, and `scope` on `PretableAggregateFormatInput`. Code that
  only reads these types is unaffected.

### Patch Changes

- Updated dependencies [[`f691e9c`](https://github.com/cacheplane/pretable/commit/f691e9cff7d44c23d3df2439e75ab6fc4950cd2c)]:
  - @pretable/core@0.1.0
  - @pretable/ui@0.1.0

## 0.0.14

### Patch Changes

- Document both required React 19 peer dependencies in the package README. ([#271](https://github.com/cacheplane/pretable/pull/271))

- Updated dependencies []:
  - @pretable/core@0.0.14
  - @pretable/ui@0.0.14

## 0.0.13

### Patch Changes

- Split the grid's line vocabulary and give numeric columns real alignment. ([#269](https://github.com/cacheplane/pretable/pull/269))

  `--pretable-rule` previously coloured both the horizontal row hairline and the
  vertical column divider, so no theme could drop the vertical gridlines without
  also losing row separation. Two new tokens, `--pretable-rule-vertical` and
  `--pretable-rule-width`, split the axes. Both shipped themes alias the vertical
  token back to `--pretable-rule`, so Excel and Material render unchanged.

  Columns now carry an optional `align` (`"start" | "center" | "end"`), and the
  surface emits `data-pretable-column-type` and `data-pretable-column-align`.
  Number columns default to trailing alignment with tabular, lining figures — in
  the grid's own font, not a monospace substitute. Alignment uses
  `justify-content: safe flex-end`; the `safe` keyword matters, because a plain
  trailing alignment clips an over-wide value at its leading edge, which would
  render `1,234,567` as a legible and completely wrong `34,567`.

  Fixes a bug where header cells, which render as `<button>`, never reset the
  user-agent button background — so the grid only looked correct in apps that
  happen to ship a CSS reset.

  Removes three declarations that never painted: the `[data-pretable-numeric]`
  rule, which nothing has ever emitted despite `@pretable/ui`'s README advertising
  it as part of the public attribute contract; the `[data-pretable-toolbar]` and
  `[data-pretable-status-bar]` rules, which no component can emit; and the
  selection rule's `background`, which could never win against the `aria-selected`
  rule that follows it at equal specificity. The selection rule keeps its `color`,
  which is load-bearing.

- Updated dependencies [[`943b21a`](https://github.com/cacheplane/pretable/commit/943b21a63cb2e62d2eb842f47a5c4e4e084e4c91)]:
  - @pretable/core@0.0.13
  - @pretable/ui@0.0.13

## 0.0.12

### Patch Changes

- Group panel: chips that do not fit now scroll instead of being clipped. ([#267](https://github.com/cacheplane/pretable/pull/267))

  The strip was a nowrap flex row at a fixed height with `overflow: hidden`, so
  grouping by enough columns painted the later levels into dead space — unreachable
  by mouse, and focusable-but-invisible by keyboard. It now scrolls horizontally,
  keeping the fixed height that `PretableSurface` subtracts from `viewportHeight`.

  - `overflow-x: auto` on the panel, with `scrollbar-width: thin` so a classic
    scrollbar cannot eat a third of a compact strip.
  - A focused chip is revealed inside the strip, and only inside it: chips are
    focused with `preventScroll` so revealing one cannot scroll the surrounding
    page sideways.
  - A chip or header drag held near either edge autoscrolls the strip, so a drop
    position that is scrolled out is still reachable.

- Updated dependencies []:
  - @pretable/core@0.0.12
  - @pretable/ui@0.0.12

## 0.0.11

### Patch Changes

- Reconcile the selection when the drawn column model changes, so grouping or ([#264](https://github.com/cacheplane/pretable/pull/264))
  ungrouping no longer drops full-row selections, double-toggles a row, or copies
  a single column instead of the whole row.

- Give the header row the pixel it shares with the group panel. The panel and the ([#264](https://github.com/cacheplane/pretable/pull/264))
  scroll viewport abut exactly, so the panel's bottom edge is the header's top
  edge — and the panel's hit test claimed it. Dropping a dragged header on the
  header's first row of pixels grouped by that column instead of reordering it.
  The panel's rect is now half-open on its right and bottom edges.

- Stop invalidating the derived rows for a re-created `value` closure on a grid ([#264](https://github.com/cacheplane/pretable/pull/264))
  that is not grouped by that column. An inline `columns={[…]}` array no longer
  emits — and no longer destroys `visibleRows` identity — on every parent update.

- Reconcile the selection when a column is reordered, pinned, or the layout is ([#264](https://github.com/cacheplane/pretable/pull/264))
  reset. A range does not need to lose a column to break — it only needs the
  columns between its endpoints to change — so dragging a header used to leave a
  selected row half-checked and make Cmd+C copy the wrong columns, with no
  grouping involved at all.

- Accept `groupColumn`, `hideGroupedColumns`, `aggregateFilteredRows` and ([#264](https://github.com/cacheplane/pretable/pull/264))
  `groupsDefaultExpanded` on `usePretable` and `<PretableSurface>`, and re-export
  `PretableGroupColumnOptions`. `groupColumn={{ pinned: "left" }}` is now
  reachable from React, which is the only way to seat the tree column ahead of
  left-pinned data columns.
- Updated dependencies [[`6131d84`](https://github.com/cacheplane/pretable/commit/6131d8441b58560dd4c0c8e9d102c524bb25d602), [`6131d84`](https://github.com/cacheplane/pretable/commit/6131d8441b58560dd4c0c8e9d102c524bb25d602), [`6131d84`](https://github.com/cacheplane/pretable/commit/6131d8441b58560dd4c0c8e9d102c524bb25d602)]:
  - @pretable/core@0.0.11
  - @pretable/ui@0.0.11

## 0.0.10

### Patch Changes

- Prevent populated server-rendered grids from triggering React hydration recovery when CSS theme heights differ from package fallbacks. ([#261](https://github.com/cacheplane/pretable/pull/261))

- Updated dependencies []:
  - @pretable/core@0.0.10
  - @pretable/ui@0.0.10

## 0.0.9

### Patch Changes

- Fix row grouping selection, focus, clipboard output, and treegrid accessibility, ([#259](https://github.com/cacheplane/pretable/pull/259))
  including keyboard grouping controls and expansion announcements.
- Updated dependencies [[`f1b9e43`](https://github.com/cacheplane/pretable/commit/f1b9e4391daf3b57ae987fd022ea577ad81e0e3b)]:
  - @pretable/core@0.0.9
  - @pretable/ui@0.0.9

## 0.0.8

### Patch Changes

- Let header text follow `--pretable-text-header` instead of an inline ([#256](https://github.com/cacheplane/pretable/pull/256))
  `color: inherit`, which beat the skin and silently rendered header labels in the
  body-cell color. Completes the pair with the header divider fix: header text is
  now dimmer than cell text again, in both light and dark themes, and consumer
  token overrides reach it.
- Updated dependencies []:
  - @pretable/core@0.0.8
  - @pretable/ui@0.0.8

## 0.0.7

### Patch Changes

- Render grouped rows with a derived group column, aggregate formatting, and the ([#255](https://github.com/cacheplane/pretable/pull/255))
  ARIA treegrid keyboard model. Grouped grids now expose expandable hierarchy
  rows with themed indentation and keep focus anchored when groups collapse.

- Let header dividers inherit `--pretable-rule` from the grid skin instead of a ([#252](https://github.com/cacheplane/pretable/pull/252))
  fixed inline color, so they match body gridlines in light and dark themes and
  respond to consumer token overrides.
- Updated dependencies [[`99597d1`](https://github.com/cacheplane/pretable/commit/99597d13123ad2631f377855e0e046a54058cbb9), [`5ebfa8a`](https://github.com/cacheplane/pretable/commit/5ebfa8ae336b350f8a53e40845c700bb3b0a31a6)]:
  - @pretable/core@0.0.7
  - @pretable/ui@0.0.7

## 0.0.6

### Patch Changes

- Add `column.flex` — fill the container instead of guessing widths. ([#249](https://github.com/cacheplane/pretable/pull/249))

  Every column was fixed: `widthPx`, or a fallback, or a one-off measurement from
  `autosize`. Nothing sized to the container, so a grid either stopped short of
  its right edge or ran past it, and the only recourse was hand-tuning `widthPx`
  for one target width — which stops being right at any other window size.

  `flex` gives a column a share of whatever the fixed columns leave over. Weights
  are relative: two columns at `flex: 1` split the remainder evenly; `1` and `3`
  split it a quarter to three quarters. `minWidthPx`/`maxWidthPx` still apply, and
  a column carrying an explicit `widthPx` — including one a resize drag produced —
  stops flexing, since an explicit width outranks a computed one.

  Distribution is exact: the final flex column absorbs the rounding remainder, so
  the row ends on the viewport edge rather than a pixel short. Grids with no flex
  column render byte-for-byte as before, as does any grid whose viewport has not
  been measured yet (SSR, and the first paint before the scrollport is read).

- Updated dependencies [[`c2581fb`](https://github.com/cacheplane/pretable/commit/c2581fb5f630740aedc890670fedc532647cf21e)]:
  - @pretable/core@0.0.6

## 0.0.5

### Patch Changes

- Add `onRowSelectionChange` — the checked rows, for bulk actions. ([#230](https://github.com/cacheplane/pretable/pull/230))

  `rowSelectionColumn` draws the checkboxes, but there was no way to read what
  they had checked. `onSelectedRowIdChange` reports a single row, and
  `onSelectionChange` reports raw cell ranges — spans of `(startRowId, endRowId)`
  that a consumer cannot expand, because they only mean something against the
  rendered row order, which the grid owns once sorting is applied. So the one
  thing checkboxes are for — "do this to the rows I ticked" — was unreachable.

  `onRowSelectionChange` fires with those row ids in rendered order whenever the
  set changes, and stays quiet when it doesn't (selection is recomputed on every
  render, including every poll that hands down new rows). Available on both
  `<PretableSurface>` and the `<Pretable>` drop-in. The grid already tracked this
  set internally to draw the checkboxes; this exposes it.

- Updated dependencies []:
  - @pretable/core@0.0.5

## 0.0.4

### Patch Changes

- Column array order is now visual order, and reordering pins symmetrically. ([#220](https://github.com/cacheplane/pretable/pull/220))

  `planColumns` renders columns in three regions — left-pinned, scrollable,
  right-pinned — so a column's index in the engine array is the position it
  actually renders at only while that array is already grouped that way. Three
  consumers depended on this silently: `aria-colindex`, the reorder gesture's drop
  hit test, and the column-offset map it scans. `setColumnPinned` maintained the
  grouping. `moveColumn` and every path that accepted columns from outside did not.

  Two symptoms, one cause. A right-pinned column dragged to array index 0 kept its
  pin — reordering deliberately does not silently unpin — but then sat at index 0
  while rendering last, so assistive technology announced "column 1" for a column
  drawn at the far right. And an unpinned column dropped past the right-pinned
  group landed after it with no auto-pin, while the left region had an
  auto-pin/unpin rule.

  **`moveColumn` now derives the moved column's pin from the region it lands in.**
  The leading pinned region gives it `"left"`, the trailing region gives it
  `"right"`, and anywhere between the two leaves it unpinned. Left-region behavior
  is unchanged — same boundary computation, same predicate, same result — and the
  right is now its exact mirror.

  **Behavior change: a right pin can now be lost to a drag**, exactly the way a
  left pin already could. Dragging a right-pinned column out of the trailing group
  unpins it; dragging any column into that group pins it there. If you relied on a
  right pin surviving every reorder, set `reorderable: false` on that column. When
  pin state changes alongside a reorder, `onColumnPinnedChange` fires alongside
  `onColumnOrderChange` in the same commit, as before.

  Because the drop index is adjusted for the fact that `moveColumn` removes a
  column before re-inserting it, each pinned column is a two-halves target: its
  leading half drops ahead of the group and stays scrollable, its trailing half
  drops inside it and takes the pin.

  **Columns are regrouped on the way in, not just on mutation.** A `columns` array
  that interleaves pinned and unpinned entries is now normalized at mount, on every
  prop update, and on `resetColumnLayout`, with relative order preserved inside each
  region. The sharp edge was the prop path: `mergeColumnsFromProps` rebuilds in the
  consumer's declared order while merging _runtime_ pin state back in, so any prop
  update after a user pinned something re-broke the grouping — and with it
  `aria-colindex` — until the next reorder. Declaring
  `[symbol, note (right), name]` is fine; it becomes `[symbol, name, note]`.

  The synthetic row-select column leads its own region rather than the whole array.
  It is pinned left by default, where those are the same thing, but
  `rowSelectionColumn.pinned: false` makes it scrollable, and seating it at index 0
  ahead of the left-pinned run would be the very desync this prevents.

  **New: `grid.setColumnOrder(ids)`** reconciles a whole relative order in one
  commit. Ids matching no column are ignored, columns the caller omitted keep their
  current relative order at the end, the synthetic row-select column stays at
  position 0, and no column's pin changes.

  **Behavior change: controlled `columnOrder` is a relative order, not a literal
  layout.** It is regrouped by each column's current pin state before being
  applied, so an order that interleaves pinned and unpinned ids is normalized rather
  than honored position-for-position; `columnPinned` and the column config own pin
  state. This also fixes a hang: the reapply previously replayed the order as one
  `moveColumn` per column, and against a `columnOrder` that disagreed with
  `columnPinned` the two passes could not settle — the order pass unpinned, the pin
  pass re-pinned and repositioned, the snapshot changed, and the effect ran again.
  `setColumnOrder` never touches pin state, so they now converge.

  `aria-colindex` itself is unchanged. It is correct once the invariant holds,
  which keeps one source of truth for a column's position.

- Updated dependencies [[`9138176`](https://github.com/cacheplane/pretable/commit/9138176fb8c6906ba8ca884445285ba9141fb4da)]:
  - @pretable/core@0.0.4

## 0.0.3

### Patch Changes

- Add `onRowActivate` for "open the record this row stands for". ([#211](https://github.com/cacheplane/pretable/pull/211))

  Activating a row and selecting cells are different intents, but the only signal
  available was `onSelectedRowIdChange`, which is tied to selection: a plain click
  selects a single cell, never a full row, so it never fired. Consumers had to
  hand-roll an `onClick` through `getRowProps`.

  `onRowActivate` fires on a plain click anywhere in a row and on Enter/Space on
  the focused cell, receiving `{ row, rowId, rowIndex }`. A modifier-click, the
  click that ends a drag-select, and a click inside a cell that is being edited
  are all something else, and do not activate. Available on both
  `<PretableSurface>` and the `<Pretable>` drop-in.

- Keep grid state alive when the `columns` prop gets a new identity. ([#211](https://github.com/cacheplane/pretable/pull/211))

  Row data is already reconciled in place via `grid.setRows`, but `columns` was
  not: a new array identity recreated the grid, taking every slice it owns with it
  — sort, filters, selection, focus, column widths and order, and an in-flight
  cell edit. An inline `columns={[...]}` is a new identity on every render, so
  "keep `columns` a stable reference" was load-bearing rather than an
  optimisation; forget it and clicking a header to sort silently stops working.

  `columns` now merges into the live grid the same way rows do. Two supporting
  changes make that safe:
  - The merge runs on every identity change rather than only when the set of
    column ids changes, so a changed header, width, or accessor is picked up.
  - `mergeColumnsFromProps` only notifies subscribers when something observable
    actually moved, so re-creating the array without changing anything is a no-op
    instead of a render loop. Column definitions are stored either way, which is
    what keeps a re-created `value`/`format` closure from going stale.

- Fix autosize after an empty first render, header layout, and cell clipping. ([#211](https://github.com/cacheplane/pretable/pull/211))
  - `setRows` now re-runs autosize against the incoming rows. Fetch-then-render is
    the usual order, so the first pass sees no rows and autosize can only fall
    back to its minimum width — which it then kept for the rest of the grid's
    life. Measured from the original column definitions, since autosize skips any
    column that already carries a width; widths the consumer set are left alone.
  - The header cell's inline style was `display: grid` with `align-items: start`.
    Inline styles beat the skin no matter how it is layered, so this quietly
    overrode `[data-pretable-header-cell]`'s `display: flex; align-items: center`
    in `@pretable/ui`, and stacked any multi-node `renderHeaderCell` into rows
    that overflow the header strip. Now flex/center, matching the skin.
  - The default header rendered the words "Newest", "Oldest", and "Sort" — date
    vocabulary applied to every column, which reads wrong on a name or a number.
    Sorted columns now show a direction glyph (`▲`/`▼`) carrying
    `data-pretable-sort-indicator` for themes to target; unsorted columns show
    none, with `aria-sort` and the button's `aria-label` carrying the state.
    **Consumers asserting on that text will need to update**; `renderHeaderCell`
    still overrides the default entirely.
  - Body cells now set `overflow: hidden`. Cells are absolutely positioned, so a
    value wider than its column used to paint straight over its neighbour. Note
    that a cell is a flex container, where `text-overflow: ellipsis` has no
    effect — for an ellipsis, render the value inside a shrinkable element
    (`min-width: 0`) via the column's `render`.

- Updated dependencies [[`7765a95`](https://github.com/cacheplane/pretable/commit/7765a95f5d7d207c6b962e29b0766f117c39570e)]:
  - @pretable/core@0.0.3
  - @pretable/ui@0.0.3

## 0.0.2

### Patch Changes

- Add MIT license metadata, repository links, homepage links, and issue tracker ([#104](https://github.com/cacheplane/pretable/pull/104))
  metadata to the public packages as part of the open-source community health
  pass.
- Updated dependencies [[`a63886d`](https://github.com/cacheplane/pretable/commit/a63886d2131150f810c5210e0e1861f3ac6f8d09)]:
  - @pretable/core@0.0.2
  - @pretable/ui@0.0.2

## 0.0.1

### Patch Changes

- Internal `react-surface` workspace package collapsed into `@pretable/react`. ([#66](https://github.com/cacheplane/pretable/pull/66))
  All grid components are now exported directly from the public package:
  - `<PretableSurface>` — the kitchen-sink grid component
  - `<InspectionGrid>` — preset for inspection-style data
  - `<LabeledGridSurface>` — preset with labeled cells

  The opinionated `<Pretable>` preset stays. The `interactionState` prop on
  `<PretableSurface>` is marked `@experimental` — bench-internal feature
  exposed for advanced consumers, shape may change.

- Initial release. Pretable's wrapped-text scroll wedge (4× faster than Grid Alpha on S2/hypothesis), streaming row-stability win (H15 satisfied — pretable max visible-row drift = 1 vs Grid Alpha's 28 across 100–25,000 patches/sec), and end-to-end React adapter with reusable JSON streaming primitives. ([#58](https://github.com/cacheplane/pretable/pull/58))

  See [the publishing pipeline design](https://github.com/cacheplane/pretable/blob/main/docs/superpowers/specs/2026-05-01-npm-publishing-pipeline-design.md) for context on the build, verification, and release flow.

- Updated dependencies [[`c1fb1d3`](https://github.com/cacheplane/pretable/commit/c1fb1d3266dad24153de60b92931147f14667d5a)]:
  - @pretable/core@0.0.1
