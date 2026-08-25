---
"@pretable/react": minor
"@pretable/ui": minor
---

Tool panel: a rail-and-pane shell on `PretableSurface`, on by default, opening
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
