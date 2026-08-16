---
"@pretable/react": minor
---

`PageUp` / `PageDown` go through the engine, so an evicted cursor holds instead
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
