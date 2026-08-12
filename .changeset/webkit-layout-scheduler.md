---
"@pretable/react": patch
---

Fix a WebKit-only stall that left large grids blank for hundreds of milliseconds after mount.

The row-layout controller yields between build slices, and its fallback scheduled each continuation with `setTimeout(task, 0)`. Because every slice schedules the next from inside the previous one, those are nested zero-delay timers, which browsers clamp to ~4ms — pure latency, paid per slice, while the grid shows nothing. Safari ships no `scheduler.postTask`, so it always took that path.

Measured on a 2,500 × 500 grid, mount to first painted cell: WebKit 263ms across 25 timer hops, against 13ms in Chromium; removing `postTask` from Chromium reproduced the stall exactly (176–190ms), so the engine was never the variable. The fallback now prefers an unclamped `MessageChannel` message, the same ladder the row model's cooperative transition already used, and WebKit lands at ~15ms.
