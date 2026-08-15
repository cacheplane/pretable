---
"@pretable/core": minor
"@pretable/react": minor
---

Eviction: the focused cell and the selection anchor survive their rows being
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
