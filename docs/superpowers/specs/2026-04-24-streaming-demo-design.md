# Streaming Demo App Design

## Goal

A standalone replay-style demo app that plays back a captured OpenAI Responses stream into a Pretable grid with a realtime pipeline inspector, demonstrating the streaming wedge: _Pretable renders LLM-streamed data without jank at scale._

Visitors land on the page, the demo autoplays, and they watch ~2,500 rows pour into a Bloomberg-modern grid while stream events and parser state update in lockstep in a side rail. After the table finishes filling (~30 s), the demo transitions into a "live updates" phase where prices flicker continuously across the whole grid. A transport bar at the bottom offers play/pause, scrub, and speed controls.

## Architecture

```
recordings/
  phase1.jsonl   Real OpenAI Responses capture: chunks + relative timestamps (~30 s)
  phase2.jsonl   Pre-computed random-walk price updates (~90 s)

Replay engine (browser)
  ├─ Loads both JSONL files at startup
  ├─ Maintains a virtual clock advanced by dt × playback_speed each frame
  ├─ Dispatches all entries whose t ≤ clock since last tick
  ├─ Phase 1: text deltas → @cacheplane/json-stream parser →
  │            complete elements → @pretable/stream-adapter batcher →
  │            grid.applyTransaction({ add })
  └─ Phase 2: pre-materialized patches → batcher.update(patches)

UI surfaces (layout D — right rail inspector)
  ├─ Grid (~75% width, Pretable react surface, Bloomberg-modern theme)
  ├─ Right rail (~25% width)
  │    ├─ Stream events (top half): recent chunks, newest highlighted
  │    └─ Parser AST (bottom half): current tree + active mode badge
  └─ Transport bar (bottom)
       ├─ Play/pause button
       ├─ Scrub slider (maps to virtual clock)
       ├─ Speed selector (0.5× / 1× / 2× / 4×)
       ├─ Elapsed / total time display
       └─ Phase indicator (fill → live)
```

Data flow into the grid uses the two adapter APIs back-to-back — element streaming for phase 1, direct update batching for phase 2 — which exercises most of the adapter's surface area.

## Decision Log

| #   | Decision                   | Choice                                                                                                                 | Rationale                                                                                                                          |
| --- | -------------------------- | ---------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| 1   | App form factor            | Standalone Vite + React app at `apps/streaming-demo`                                                                   | Isolates from the pitch landing effort on `feat/website-surfaces`; ships independently; no conflicts                               |
| 2   | Layout                     | Grid-dominant (~75%) with right-rail pipeline inspector and bottom transport                                           | User-validated during brainstorming. Wide-screen friendly, reads as "main content + dev tools"                                     |
| 3   | Visual theme               | Bloomberg-modern: near-black `#0a0a0f`, muted text, green/red accents, modern monospace                                | Unmistakably "financial data" without DOS-era cheesiness. Sits apart from brand theme so grid density drives the feel              |
| 4   | Demo content               | ~2,500 fictional-price rows keyed on real ticker symbols (AAPL, GOOGL, …) with a "prices fictional" disclaimer         | Real tickers are viscerally recognizable; fictional prices eliminate market-data confusion                                         |
| 5   | Streaming mode             | Hybrid: phase 1 element-stream table fill (~30 s), phase 2 continuous updates (~90 s)                                  | Exercises both `connectElementStream` and `batcher.update()` paths. Matches the wedge story: "fill a table, then keep updating it" |
| 6   | Recording source — phase 1 | Captured once from real `openai.responses.create()` → JSONL, checked in                                                | Proves the adapter handles a genuine LLM stream. One-time capture cost, fully deterministic replay after                           |
| 7   | Recording source — phase 2 | Pre-computed seeded random walk → JSONL, checked in                                                                    | Deterministic scrub-back semantics; no runtime RNG state to manage; tiny generator script keeps the file reproducible              |
| 8   | Autoplay                   | On by default, loops on end                                                                                            | Zero-click wow for first-time visitors                                                                                             |
| 9   | Speed control              | 0.5× / 1× / 2× / 4× selector                                                                                           | 2× and 4× let impatient viewers skip ahead; 0.5× for demos where someone wants to point at details                                 |
| 10  | Scrub strategy             | Set virtual clock; rewind parser state by replaying phase-1 chunks from 0 to target; rebuild grid by replaying all ops | Phase 1 is ~30 s of chunks; re-parsing in-memory is sub-millisecond. Simpler than checkpointing and immune to drift                |
| 11  | Update rate (phase 2)      | ~500 patches/s across the 2,500 rows (each row updates every ~5 s on average)                                          | Visually chaotic enough to feel alive; genuinely stresses the batcher under realistic load                                         |
| 12  | Theme tokens               | Local CSS file; does NOT consume `@pretable/ui` (warm/brand tokens conflict with Bloomberg-modern)                     | Keeps the streaming demo's aesthetic distinct from the pitch landing page                                                          |
| 13  | Capture API key            | Developer-supplied at capture time via `OPENAI_API_KEY` env var; not needed at app build or runtime                    | Recording file is the artifact; no secrets in the browser or CI                                                                    |

---

## Package structure

```
apps/streaming-demo/
├── package.json                     # Vite + React app, workspace deps
├── tsconfig.json                    # App-level TS config
├── vite.config.ts                   # Vite config (mirrors apps/playground)
├── index.html                       # Mount point
├── src/
│   ├── main.tsx                     # ReactDOM mount
│   ├── app.tsx                      # Top-level shell (layout D)
│   ├── replay-engine.ts             # Virtual clock, dispatch loop, scrub
│   ├── replay-engine.test.ts        # Engine tests
│   ├── recording-loader.ts          # Fetches and parses phase1.jsonl + phase2.jsonl
│   ├── components/
│   │   ├── streaming-grid.tsx       # Pretable surface, column defs
│   │   ├── stream-inspector.tsx     # Right-rail panel composer
│   │   ├── stream-events-panel.tsx  # Recent chunks list
│   │   ├── parser-ast-panel.tsx     # Tree view + mode badge
│   │   └── transport-bar.tsx        # Play/scrub/speed controls
│   ├── theme/
│   │   └── bloomberg.css            # Theme tokens + data-density styles
│   └── recordings/                  # Checked-in replay assets
│       ├── phase1.jsonl             # Real OpenAI capture
│       └── phase2.jsonl             # Generated random walk
└── scripts/
    ├── capture-phase1.ts            # Runs openai.responses.create(), writes phase1.jsonl
    └── generate-phase2.ts           # Seeded PRNG random walk, writes phase2.jsonl
```

Responsibilities:

- `replay-engine.ts` — pure TypeScript, no DOM. Clock, dispatch, scrub, play/pause. Owns no React state. Emits events a React adapter subscribes to.
- `recording-loader.ts` — single responsibility: fetch + parse JSONL to typed arrays.
- `streaming-grid.tsx` — wraps the Pretable React surface with the column definitions and plumbs the adapter's batcher into `grid.applyTransaction`.
- `stream-inspector.tsx` / `stream-events-panel.tsx` / `parser-ast-panel.tsx` — presentational; subscribe to engine state.
- `transport-bar.tsx` — the only surface that calls play/pause/scrub on the engine.
- `theme/bloomberg.css` — CSS variables (`--bg`, `--panel`, `--text`, `--muted`, `--border`, `--up`, `--down`) and monospace/inter font stacks.

---

## Recording file formats

### `recordings/phase1.jsonl`

One JSON object per line. Each entry is a single event from the OpenAI Responses stream, timestamped relative to the capture start.

```json
{"t": 0.042, "type": "response.output_text.delta", "delta": "[\n  {\n"}
{"t": 0.061, "type": "response.output_text.delta", "delta": "    \"symbol\": \"AAPL\","}
{"t": 0.088, "type": "response.output_text.delta", "delta": " \"name\": \"Apple Inc\","}
…
{"t": 29.941, "type": "response.output_text.done"}
```

Only `response.output_text.delta` entries carry chunk text; other event types (`response.created`, `response.output_text.done`, `response.completed`) are preserved for the stream-events panel display but are no-ops for the parser.

The `delta` text, when concatenated in order, is exactly the raw JSON document (a single `[...]` array of 2,500 objects) that the LLM produced.

### `recordings/phase2.jsonl`

One JSON object per line. Each entry is a pre-computed batch of row updates at a specific virtual time.

```json
{"t": 30.1, "patches": [{"id": "AAPL", "last": 193.5, "change_pct": 2.32, "volume": 48223000, "last_update": "14:23:45"}, {"id": "GOOGL", …}]}
{"t": 30.12, "patches": [{"id": "NVDA", "last": …}]}
…
{"t": 119.998, "patches": […]}
```

Each `patches` array is fed directly to `batcher.update(patches)` when the virtual clock crosses `t`. The generator script guarantees:

- Every patch includes `id` (the real ticker symbol, matching phase 1)
- `last` evolves via seeded random walk bounded to within ±5% of its phase-1 start
- `change_pct` is recomputed as `(last - start) / start * 100`, rounded to two decimals
- `volume` monotonically accumulates a pseudo-random tick
- `last_update` reflects the virtual clock time, formatted HH:MM:SS

---

## Data model

Real ticker symbols, ~2,500 rows. Disclaimer in footer: _"Prices fictional — demo replay."_

| Column        | Type            | Example        | Phase 1 (add) | Phase 2 (update) |
| ------------- | --------------- | -------------- | ------------- | ---------------- |
| `id`          | string (row ID) | `"AAPL"`       | ✓ set         | (key)            |
| `symbol`      | string          | `"AAPL"`       | ✓ set         | —                |
| `name`        | string          | `"Apple Inc"`  | ✓ set         | —                |
| `last`        | number          | `193.42`       | ✓ set         | ✓ updated        |
| `change_pct`  | number          | `2.3`          | ✓ set         | ✓ updated        |
| `volume`      | number          | `48221000`     | ✓ set         | ✓ updated        |
| `sector`      | string          | `"Technology"` | ✓ set         | —                |
| `last_update` | string          | `"14:23:45"`   | ✓ set         | ✓ updated        |

Grid column display:

- `symbol` — bold monospace, left-aligned
- `name` — Inter, truncated with ellipsis on overflow
- `last` — monospace, right-aligned, 2 decimals
- `change_pct` — monospace, right-aligned, colored green (`--up`) for positive / red (`--down`) for negative, prefix `+` or `−`
- `volume` — monospace, right-aligned, formatted with K/M/B suffix (e.g., `48.2M`)
- `sector` — Inter, left-aligned
- `last_update` — monospace, right-aligned, HH:MM:SS

---

## Replay engine

### Virtual clock

```ts
interface EngineState {
  clock: number; // virtual seconds elapsed
  speed: number; // 0.5 | 1 | 2 | 4
  playing: boolean; // autoplay started, not paused
  totalDuration: number; // max(t) across both recordings
}
```

RAF loop: `clock += (realDt × speed)`; if clock ≥ totalDuration, reset to 0 after a 1 s visual pause.

### Dispatch loop

Engine maintains two cursors (`phase1Index`, `phase2Index`) into the loaded arrays. Each RAF tick:

```
while phase1[phase1Index].t ≤ clock:
  dispatch phase1[phase1Index] to parser
  phase1Index++

while phase2[phase2Index].t ≤ clock:
  batcher.update(phase2[phase2Index].patches)
  phase2Index++
```

Parser dispatch pushes the chunk through `@cacheplane/json-stream`'s `push()`, then checks the root array for newly-complete children to forward to `batcher.add([row])`.

### Scrub

When the transport scrubs to a new time:

1. Reset parser state (`create()` a fresh `StreamState`)
2. Reset batcher (flush, recreate)
3. Reset grid by recreating the grid store from scratch (simpler and faster than iterating 2,500 remove ids)
4. Set cursors to 0
5. Set clock to target time
6. Run the dispatch loop once to catch up

For phase 1, this re-parses all chunks from 0 to target. For phase 2, it replays all patches — which is fine because patches are idempotent (each sets `last`, `change_pct`, etc. outright).

### Play / pause

- `play()` sets `playing = true` and starts the RAF loop if not already running
- `pause()` sets `playing = false` and cancels the RAF loop
- `setSpeed(speed)` updates the multiplier; takes effect on the next frame

---

## UI behavior

### Stream events panel (top half of right rail)

Shows a rolling window of the N most recent stream events (default N = 8). Each entry renders:

```
.delta "e\",\"summary\":\"design"     ← newest, highlighted background
.delta "\",\"hq\":\"remot"
.delta "\"company\":\"Linear\","
…
```

Non-`delta` events render with a colored tag (e.g., `[created]`, `[done]`). When phase 2 is active, the panel switches to showing patch batches:

```
.patches (42 rows)                     ← newest, highlighted
.patches (38 rows)
…
```

### Parser AST panel (bottom half of right rail)

Three stacked sections:

1. Current mode badge: `StringValue`, `NumberValue`, `ArrayItemOrEnd`, etc. — the parser's internal mode name
2. Tree view: a compact rendering of the AST. Collapsed by default; the node currently being built is highlighted. Approximately:
   ```
   array (1,284 / 2,500 items, incomplete)
     [1282] object ✓
     [1283] object ✓
     [1284] object (building)
       "symbol": "NVDA" ✓
       "name": "NVIDIA" ✓
       "last": 485.2▎
   ```
3. Resolved value preview: `state.resolve()`'s output on the current streaming row, if a row is in progress.

During phase 2, the parser isn't running, so the panel shows:

```
[phase 2: live updates]
patches delivered: 12,384
last patch: { id: "AAPL", last: 193.51, change_pct: 2.35, … }
```

### Transport bar

```
[▶]  [0:23 / 2:00]  ←—●——————————————→  [phase: fill]  [1×▾]
```

- Play/pause toggles
- Clickable scrub bar; dragging the thumb scrubs in realtime (engine handles)
- Time display: `M:SS / M:SS`
- Phase indicator shows `fill` during phase 1 (clock < 30 s), `live` during phase 2
- Speed dropdown: `0.5× / 1× / 2× / 4×`
- Loop-end behavior: autoplay continues, 1 s visual pause at end then restart

---

## Capture workflow (phase 1 recording)

One-time developer workflow, documented in `apps/streaming-demo/README.md`:

```
cd apps/streaming-demo
export OPENAI_API_KEY=sk-...
pnpm run capture
# writes src/recordings/phase1.jsonl (~400 KB expected)
git add src/recordings/phase1.jsonl
git commit -m "chore(streaming-demo): refresh phase1 recording"
```

The capture script (`scripts/capture-phase1.ts`):

1. Connects to OpenAI Responses API (`openai.responses.create()` with `stream: true`)
2. Uses the best model available at capture time (`gpt-5` or whatever is current; parameterized by env var `OPENAI_MODEL`, defaulting to `gpt-5`)
3. Prompt: _"Generate exactly 2500 fictional stock tickers as a single JSON array of objects. Fields per object: `symbol` (4-5 uppercase chars), `name`, `last` (number 1–5000 with 2 decimals), `change_pct` (number -10 to 10 with 2 decimals), `volume` (integer 100000 to 100000000), `sector` (one of: Technology, Healthcare, Financials, Consumer, Energy, Industrials, Materials, Utilities, RealEstate, Communication), `last_update` (string HH:MM:SS representing a plausible US market hours time). Output the JSON array only, no prose."_
4. Records each SSE event with `t = performance.now() - start`
5. Writes to `src/recordings/phase1.jsonl`
6. On completion, prints a summary (row count, total duration, avg chunks/sec)

The capture is non-deterministic — re-running produces a different recording. The checked-in file is the canonical "demo performance" and is only refreshed when intentionally updating the demo content. If the OpenAI output is malformed (parser rejects it), the developer re-runs the capture; the script aborts and reports the parser error.

## Generate phase 2 workflow

```
cd apps/streaming-demo
pnpm run generate-phase2
# writes src/recordings/phase2.jsonl
git add src/recordings/phase2.jsonl
git commit -m "chore(streaming-demo): regenerate phase2 updates"
```

The generator script (`scripts/generate-phase2.ts`):

1. Reads `src/recordings/phase1.jsonl`
2. Concatenates the `delta` text to reconstruct the full JSON array; parses it with the same `@cacheplane/json-stream` library to get the seed row set
3. Seeds a deterministic PRNG (e.g., mulberry32 with seed `0xC0FFEE`)
4. Generates 90 seconds of update batches at ~500 patches/s, grouped by frame (~16 ms buckets → ~8 patches per batch)
5. For each batch: pick random rows, perturb `last` by a small random-walk step (bounded ±5% from phase-1 start), recompute `change_pct`, increment `volume`, set `last_update` to the virtual-clock time
6. Writes to `src/recordings/phase2.jsonl`

This runs in pure Node, no network, fully deterministic.

---

## Test plan

### Replay engine (unit tests in `replay-engine.test.ts`)

- Clock advances at speed × real time
- Play / pause toggles the RAF loop
- `setSpeed` takes effect next frame
- Loop: clock reset after `totalDuration`
- Dispatch: entries with `t ≤ clock` are dispatched; those with `t > clock` are not
- Scrub forward: cursors advance; parser state is rebuilt; grid state matches direct playback
- Scrub backward: full reset + replay produces identical state to forward playback to same time
- Scrub to end: all phase 1 and phase 2 entries dispatched, no pending work

### Recording loader

- Parses valid JSONL into typed arrays
- Throws a clear error on malformed lines (line number in message)
- Handles empty files gracefully (empty array, not crash)

### Stream events panel

- Rolling window: only N most recent events rendered
- Newest entry has highlight class
- Phase transition changes the panel's content format

### Parser AST panel

- Mode badge reflects the current parser mode
- Tree view shows the currently-building child with highlight
- Phase 2 state replaces tree view with patches summary

### Transport bar

- Scrub slider position matches engine clock
- Clicking the slider sets engine clock
- Speed selector updates engine speed
- Play/pause reflects engine state

### Integration smoke test

- App mounts, autoplay begins, grid accumulates rows over simulated time
- Scrubbing mid-playback reproduces the exact same grid state as playing through normally
- Phase 2 updates visible after phase 1 completes

No E2E test for the full 2-minute playback — would be too slow and fragile. Rely on the deterministic recording + visual QA during development.

---

## Deferred

- Multiple scenarios / scenario picker (v1 is single-scenario)
- Sparkline column showing recent price history
- Audio / haptic feedback on phase transition
- Realtime metrics overlay (frame p95, throughput) — the inspector panels are the "metrics" surface for v1
- Scrub preview thumbnails
- Mobile/narrow-screen responsive layout (v1 is desktop-only; the right rail collapses awkwardly below ~1200 px)
- Sort/filter interactions during playback (would need extra bookkeeping to not fight with streaming adds)
- Real market data feed — the adapter is capable, but this demo is about LLM streaming specifically
- Dark-mode toggle — the theme IS dark; no light variant
