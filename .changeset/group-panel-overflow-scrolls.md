---
"@pretable/react": patch
---

Group panel: chips that do not fit now scroll instead of being clipped.

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
