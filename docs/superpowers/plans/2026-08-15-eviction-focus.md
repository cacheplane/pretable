# Eviction: focus and anchor

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development.

**Goal:** A focused cell and a selection anchor survive their rows being evicted, exactly as a selection range now does — and DOM focus never falls to `<body>`.

**Spec:** `docs/superpowers/specs/2026-08-14-eviction-design.md` §5, **as refined below**.

---

## The spec refinement, and why

§5 says: *"The re-seat target is the nearest surviving row in the direction of travel."*

That paragraph was written **before** the evicted-vs-deleted discriminator existed, when an absent row could only mean a deleted one. Applied to eviction it is wrong for exactly the reason dropping a selection was wrong: scroll away, scroll back, and focus has silently moved. Excel and AG Grid both keep focus where the user left it and scroll it back into view.

The refined rule mirrors selection:

| The focused row is… | Focus ref | Rationale |
| --- | --- | --- |
| **evicted** (absent, outside the loaded window) | **retained** | it is coming back; the user's cursor did not move |
| **deleted** (absent, inside the window's span) | re-seat to nearest surviving | unchanged from today |
| still loaded | unchanged | unchanged |

§5's other claim — **DOM focus must never fall to `<body>`** — stands in every case and is independent of the branch above.

---

### Task 1: Focus reconciliation learns the discriminator

**Files:** `packages/grid-core/src/indexed-focus.ts` (`reconcileIndexedFocus`, ~line 48); tests alongside `indexed-selection`'s.

Today:

```ts
if (snapshot.indexOf(focus.ref) >= 0) return focus;
const nearest = snapshot.nearestVisibleRef(focus.ref);
if (nearest === undefined || snapshot.indexOf(nearest) < 0) return emptyFocus();
return Object.freeze({ ref: nearest, columnId: focus.columnId });
```

Give it the same `eviction` argument `reconcileIndexedSelection` takes — read that signature and **match it**; do not invent a second shape. Retain when `provenDeletedRow` says the row was not deleted. Re-seat otherwise.

- [ ] **Write two failing tests first.** *Evicted focus is retained* and *deleted focus still re-seats to the nearest survivor*. Both required — one without the other cannot tell a working discriminator from a dead one. The second must pass **before** the change.
- [ ] Implement.
- [ ] **Mutate:** force the retain branch off. Test 1 reddens, test 2 stays green. Report verbatim.

**With no window — local mode — behaviour must be byte-for-byte what it is today.**

### Task 2: An evicted anchor keeps its identity

**Files:** `packages/grid-core/src/indexed-selection.ts`

`anchor = ranges[0]?.start ?? null` fires whenever the anchor is not visible, so an evicted anchor migrates to the first range's start. For an upward shift-selection (anchor at `range.end`) or with multiple ranges, a later shift-click then extends from the wrong end.

An assertion already pins the current behaviour — `expect(reconciled.anchor).toEqual(selection.anchor)` in the evicted-survives test. It passes today by coincidence (that fixture's anchor equals `ranges[0].start`). **Your test must not.**

- [ ] **Write the failing test first:** an **upward** selection (anchor at `range.end`), anchor row evicted, assert the anchor is unchanged. Verify it fails before the fix — if it passes, your fixture has the same coincidence and is worthless.
- [ ] Retain the anchor when merely evicted; re-seat when proven deleted.
- [ ] **Mutate** and report both directions.

### Task 3: GATE — focus does not escape to `<body>`

**Files:** `apps/bench/tests/eviction.spec.ts` (extend), `apps/bench/src/windowed-harness.tsx` if needed.

jsdom cannot answer this: where focus lands when its element unmounts is browser behaviour.

- [ ] Focus a cell, evict its row by moving the window, and assert `document.activeElement` is **not** `<body>` — and say what it *is*.
- [ ] Move the window back; assert focus returns to the original cell and that arrow-key movement resumes from there, not from wherever the viewport is.
- [ ] Ship the mutation **as a second test in the file**, the way `windowed-data.spec.ts` does with `?windowMeta=0` — a kill switch that strips the discriminator and asserts focus is lost. Keeps the proof in CI rather than in a report.

Use a **real** `locator.click()` / `keyboard.press()`. Synthetic events would not exercise the DOM focus behaviour under test, which is the whole point.

**If focus cannot be held, STOP and report BLOCKED.** Do not weaken the assertion.

### Task 4: Verify, changeset, PR

Baselines that must not drop: grid-core **87**, layout-core **93**, renderer-dom **122**, react **1141 in 76 files**, playwright **14**.

`pnpm build` **before** `pnpm api` — a stale `dist/` silently strips exports and `api:check` will not catch it. Run `lint` and `format`; both have failed CI on this project when skipped.

---

## Do not repeat these

- **A fixture that assumes the problem away.** Eviction's count test asserted 4,901 rows with 30 loaded and reddened correctly when mutated — but its fixture made the whole dataset resident, which is a grid where eviction has not happened. Ask separately: *can the assertion fail?* and *does the setup describe the situation this exists for?*
- **Identity-valued inputs.** `getWindowSpacers` appeared in **zero** test files, so an entire conversion seam ran at `leadingHeight = 0` and a real defect passed every suite. If your test's discriminator input could be zero or absent, it proves nothing.
- **A guard that cannot see the change.** Confirm by mutation that each new test actually reaches the code it names.
