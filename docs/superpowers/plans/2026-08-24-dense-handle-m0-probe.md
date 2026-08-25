# Dense-Handle M0 Pricing Probe Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Measure, in isolated Node microbenchmarks, the cost of the three new primitives from the dense-handle spec (membership bitsets, chunked COW slot vectors, columnar verdict scans) at 50k rows, and produce a go/no-go verdict against the spec's projected filter-commit window.

**Architecture:** One self-contained Node script (no imports from the repo — these primitives don't exist yet; the probe IS their first draft) that implements minimal versions of each primitive, verifies them against naive oracles so we never time broken code, then times (a) each primitive in isolation, (b) a composed "filter-commit equivalent" that mirrors the model-side work of a 50k filter flip, and (c) chunk-COW maintenance under a streaming transaction mix. Results are compared against the trace attribution of the code being replaced (persistent-map 42.5ms, verdict pass 18.3ms, double-lookup 11.9ms — from `filter-final-results.md`).

**Tech Stack:** Node (v20+, plain JS, no deps). Method precedent: `index-representation-probe.md`, whose Node prediction landed within 2ms of the browser number.

**Context for the executor:**
- Spec: `docs/superpowers/specs/2026-08-24-dense-handle-core-design.md` (read it first).
- The probe file is throwaway measurement tooling — it lives in the session scratchpad, NOT in the repo. Only the results document is committed.
- Machine-load rule: before timing, run `uptime`; if 1-min load ≥ ~8 on this 10-core Mac, report that and rely on the spread check below rather than absolute trust. The fitness test is the control's spread: rep-to-rep spread of any median ≤ 20% or the run is invalid — rerun.
- Numbers rule: never report a single run; report median of 5 timed reps after 2 warmup reps, and report the min/max spread.

**Scratchpad directory (create the probe here):**
`/private/tmp/claude-501/-Users-blove-repos-pretable--claude-worktrees-running-examples-component-d29c33/e6a8fc40-eb1a-438e-8b29-07506e9af41d/scratchpad`

---

### Task 1: Probe primitives with correctness oracles

**Files:**
- Create: `<scratchpad>/m0-probe.mjs`

- [ ] **Step 1: Write the primitives and their oracle checks**

Create `m0-probe.mjs` with the following content (this is the complete file for Task 1; Task 2 appends to it):

```js
// M0 pricing probe — dense-handle core primitives at 50k.
// Spec: docs/superpowers/specs/2026-08-24-dense-handle-core-design.md
// Throwaway measurement code; committed artifact is the results doc only.

const N = 50_000;
const CHUNK = 1024;
const WARMUP = 2, REPS = 5;

// ---------- membership bitset (immutable-by-copy) ----------
const bsNew = (n) => new Uint32Array((n + 31) >>> 5);
const bsClone = (b) => b.slice();
const bsSet = (b, i) => { b[i >>> 5] |= 1 << (i & 31); };
const bsTest = (b, i) => (b[i >>> 5] >>> (i & 31)) & 1;
const bsXor = (a, b) => { const out = new Uint32Array(a.length); for (let i = 0; i < a.length; i++) out[i] = a[i] ^ b[i]; return out; };
const bsPopcount = (b) => { let c = 0; for (let i = 0; i < b.length; i++) { let w = b[i]; w -= (w >>> 1) & 0x55555555; w = (w & 0x33333333) + ((w >>> 2) & 0x33333333); c += (((w + (w >>> 4)) & 0x0f0f0f0f) * 0x01010101) >>> 24; } return c; };
// iterate set bits, calling f(index); returns count
function bsForEach(b, f) {
  let count = 0;
  for (let w = 0; w < b.length; w++) {
    let word = b[w];
    const base = w << 5;
    while (word !== 0) {
      const t = word & -word;
      f(base + (31 - Math.clz32(t)));
      word ^= t;
      count++;
    }
  }
  return count;
}

// ---------- chunked COW slot vector ----------
function vecFromArray(arr) {
  const chunks = [];
  for (let i = 0; i < arr.length; i += CHUNK) chunks.push(arr.slice(i, i + CHUNK));
  return { chunks, length: arr.length };
}
const vecGet = (v, i) => v.chunks[i >>> 10][i & 1023];
// COW write: copies the chunk table + the one touched chunk
function vecWith(v, i, val) {
  const chunks = v.chunks.slice();
  const c = chunks[i >>> 10].slice();
  c[i & 1023] = val;
  chunks[i >>> 10] = c;
  return { chunks, length: v.length };
}
// batched COW write for one commit: copies table once, each touched chunk once
function vecWithAll(v, writes /* [i, val][] */) {
  const chunks = v.chunks.slice();
  const copied = new Set();
  for (const [i, val] of writes) {
    const ci = i >>> 10;
    if (!copied.has(ci)) { chunks[ci] = chunks[ci].slice(); copied.add(ci); }
    chunks[ci][i & 1023] = val;
  }
  return { chunks, length: v.length };
}

// ---------- fixture ----------
// Mirrors the S2 bench shape loosely: numeric column + string column.
function mulberry32(seed) { return () => { let t = (seed += 0x6d2b79f5); t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const rnd = mulberry32(42);
const records = new Array(N);
const priceCol = new Float64Array(N);       // columnar numeric cache
const nameCol = new Array(N);               // columnar string cache
for (let s = 0; s < N; s++) {
  const price = Math.floor(rnd() * 10_000) / 10;
  const name = `instrument-${(s * 7919) % N}-${s % 97}`;
  records[s] = { id: `row-${s}`, slot: s, price, name };
  priceCol[s] = price;
  nameCol[s] = name;
}
const live = bsNew(N);
for (let s = 0; s < N; s++) bsSet(live, s);

// ---------- oracles (run before ANY timing; abort on mismatch) ----------
function assertEq(actual, expected, label) {
  if (actual !== expected) { console.error(`ORACLE FAIL: ${label}: ${actual} !== ${expected}`); process.exit(1); }
}

// Oracle 1: numeric columnar scan matches naive filter
{
  const bs = bsNew(N);
  for (let s = 0; s < N; s++) if (priceCol[s] >= 250 && priceCol[s] < 500) bsSet(bs, s);
  let naive = 0;
  for (let s = 0; s < N; s++) if (records[s].price >= 250 && records[s].price < 500) { naive++; assertEq(bsTest(bs, s), 1, `numeric bit ${s}`); }
  assertEq(bsPopcount(bs), naive, "numeric scan popcount");
}
// Oracle 2: xor-diff enumerates exactly the flipped slots
{
  const a = bsNew(N), b = bsNew(N);
  for (let s = 0; s < N; s++) { if (s % 3 === 0) bsSet(a, s); if (s % 5 === 0) bsSet(b, s); }
  const diff = bsXor(a, b);
  const flipped = [];
  bsForEach(diff, (s) => flipped.push(s));
  const expected = [];
  for (let s = 0; s < N; s++) if ((s % 3 === 0) !== (s % 5 === 0)) expected.push(s);
  assertEq(flipped.length, expected.length, "xor flip count");
  for (let i = 0; i < expected.length; i++) assertEq(flipped[i], expected[i], `xor flip order at ${i}`);
}
// Oracle 3: COW vector — writes land, snapshot validity holds under overwrite
{
  const v0 = vecFromArray(records);
  const v1 = vecWithAll(v0, [[5, { id: "row-X", slot: 5 }], [40_000, { id: "row-Y", slot: 40_000 }]]);
  assertEq(vecGet(v1, 5).id, "row-X", "cow write 5");
  assertEq(vecGet(v1, 40_000).id, "row-Y", "cow write 40000");
  assertEq(vecGet(v0, 5).id, "row-5", "snapshot validity 5");       // old snapshot unchanged
  assertEq(vecGet(v0, 40_000).id, "row-40000", "snapshot validity 40000");
  assertEq(vecGet(v1, 6).id, "row-6", "untouched neighbor");
}
console.log("oracles: PASS");
```

- [ ] **Step 2: Run the oracles**

Run: `node <scratchpad>/m0-probe.mjs`
Expected: `oracles: PASS`, exit code 0. If any `ORACLE FAIL` prints, fix the primitive before proceeding — do not time broken code.

---

### Task 2: Timed sections — isolation, composed commit, streaming maintenance

**Files:**
- Modify: `<scratchpad>/m0-probe.mjs` (append after the oracle block)

- [ ] **Step 1: Append the timing harness and measurement sections**

```js
// ---------- timing harness ----------
function bench(label, fn) {
  for (let i = 0; i < WARMUP; i++) fn();
  const times = [];
  for (let i = 0; i < REPS; i++) { const t0 = performance.now(); fn(); times.push(performance.now() - t0); }
  times.sort((x, y) => x - y);
  const med = times[REPS >> 1], min = times[0], max = times[REPS - 1];
  const spreadPct = med > 0 ? ((max - min) / med) * 100 : 0;
  console.log(`${label}: median ${med.toFixed(3)}ms  (min ${min.toFixed(3)} / max ${max.toFixed(3)}, spread ${spreadPct.toFixed(0)}%)`);
  return { med, min, max, spreadPct };
}
let sink = 0; // defeat dead-code elimination

const results = {};

// --- A. isolation: primitives ---
results.numericScan = bench("A1 numeric columnar scan -> bitset (50k)", () => {
  const bs = bsNew(N);
  for (let s = 0; s < N; s++) if (priceCol[s] >= 250 && priceCol[s] < 500) bs[s >>> 5] |= 1 << (s & 31);
  sink += bs[0];
});
results.stringScan = bench("A2 string columnar scan .includes -> bitset (50k)", () => {
  const bs = bsNew(N);
  for (let s = 0; s < N; s++) if (nameCol[s].includes("7")) bs[s >>> 5] |= 1 << (s & 31);
  sink += bs[0];
});
// old membership: ~25% visible; new: shifted band flips roughly half in/half out
const oldBs = bsNew(N);
for (let s = 0; s < N; s++) if (priceCol[s] >= 250 && priceCol[s] < 500) bsSet(oldBs, s);
const newBs = bsNew(N);
for (let s = 0; s < N; s++) if (priceCol[s] >= 375 && priceCol[s] < 625) bsSet(newBs, s);
results.xorDiff = bench("A3 xor + enumerate flipped slots", () => {
  const diff = bsXor(oldBs, newBs);
  let acc = 0;
  bsForEach(diff, (s) => { acc += s; });
  sink += acc;
});
const recordsVec = vecFromArray(records);
results.vecReads = bench("A4 50k vecGet reads (records by slot)", () => {
  let acc = 0;
  for (let s = 0; s < N; s++) acc += vecGet(recordsVec, s).price;
  sink += acc;
});
// baseline for comparison: same reads through a string-keyed Map (NOT the HAMT,
// which the trace prices at 42.5ms — this bounds how much of that is stringiness)
const byIdMap = new Map(records.map((r) => [r.id, r]));
const idList = records.map((r) => r.id);
results.mapReads = bench("A5 50k string-keyed Map.get reads (baseline)", () => {
  let acc = 0;
  for (let s = 0; s < N; s++) acc += byIdMap.get(idList[s]).price;
  sink += acc;
});

// --- B. composed filter-commit equivalent (model-side work, minus tree build) ---
// scan -> xor -> enumerate -> resolve flip-in records -> sort flip-ins by key -> merge survivors
results.composed = bench("B  composed filter-commit equivalent", () => {
  // 1. verdict scan
  const next = bsNew(N);
  for (let s = 0; s < N; s++) if (priceCol[s] >= 375 && priceCol[s] < 625) next[s >>> 5] |= 1 << (s & 31);
  // 2. diff
  const diff = bsXor(oldBs, next);
  const flippedIn = [], flippedOut = [];
  bsForEach(diff, (s) => { if ((next[s >>> 5] >>> (s & 31)) & 1) flippedIn.push(s); else flippedOut.push(s); });
  // 3. resolve + sort flip-ins by sort key (price asc, mirroring an active sort)
  flippedIn.sort((x, y) => priceCol[x] - priceCol[y]);
  // 4. merge survivors (walk old membership in slot order as a stand-in for the
  //    old-tree range walk) with sorted flip-ins into the new visible order
  const survivors = [];
  bsForEach(oldBs, (s) => { if ((next[s >>> 5] >>> (s & 31)) & 1) survivors.push(s); });
  survivors.sort((x, y) => priceCol[x] - priceCol[y]);
  const merged = new Array(survivors.length + flippedIn.length);
  let i = 0, j = 0, k = 0;
  while (i < survivors.length && j < flippedIn.length)
    merged[k++] = priceCol[survivors[i]] <= priceCol[flippedIn[j]] ? survivors[i++] : flippedIn[j++];
  while (i < survivors.length) merged[k++] = survivors[i++];
  while (j < flippedIn.length) merged[k++] = flippedIn[j++];
  // touch resolved records so the read isn't elided
  let acc = 0;
  for (let m = 0; m < merged.length; m++) acc += vecGet(recordsVec, merged[m]).slot;
  sink += acc + merged.length;
});
// NOTE for results doc: the real path does NOT re-sort survivors (order comes
// proven from the old tree walk); the survivors.sort here is deliberate
// overcounting — call it out as slack in the projection.

// --- C. streaming maintenance: chunk-COW under a transaction mix ---
const TXN_COUNT = 1000, TXN_SIZE = 100;
const txns = [];
{
  const r2 = mulberry32(7);
  for (let t = 0; t < TXN_COUNT; t++) {
    const writes = [];
    for (let w = 0; w < TXN_SIZE; w++) { const s = Math.floor(r2() * N); writes.push([s, records[s]]); }
    txns.push(writes);
  }
}
results.streaming = bench(`C  ${TXN_COUNT} commits x ${TXN_SIZE} random writes (chunk-COW)`, () => {
  let v = recordsVec;
  for (const writes of txns) v = vecWithAll(v, writes);
  sink += v.chunks.length;
});
console.log(`   per-commit: ${(results.streaming.med / TXN_COUNT * 1000).toFixed(1)}µs`);
results.bitsetClone = bench("C2 1000 whole bitset clones (6.25KB each)", () => {
  let b = oldBs;
  for (let t = 0; t < TXN_COUNT; t++) b = bsClone(b);
  sink += b[0];
});

// --- verdict ---
const newParts = results.numericScan.med + results.xorDiff.med + results.composed.med;
console.log("---");
console.log(`replaced (trace attribution): persistent-map 42.5 + verdict 18.3 + double-lookup 11.9 = 72.7ms`);
console.log(`new (probe, overcounted):     scan+diff+composed = ${newParts.toFixed(1)}ms`);
console.log(`sink: ${sink}`); // keep the JIT honest
```

- [ ] **Step 2: Check machine load, then run the full probe**

Run: `uptime`, then `node <scratchpad>/m0-probe.mjs > <scratchpad>/m0-probe-output.txt 2>&1; echo "exit=$?"` and then print the output file.
Expected: `oracles: PASS`, all sections print medians, `exit=0`. Redirect to a file and check the exit code — never pipe through `grep|head` (SIGPIPE truncates gates).

- [ ] **Step 3: Validate the run's fitness**

Check every reported spread. If any section's spread exceeds 20%, or `uptime` 1-min load was ≥ 8: rerun the probe once; if still noisy, report the noise explicitly in the results doc rather than hiding it.

---

### Task 3: Results document, go/no-go, commit

**Files:**
- Create: `docs/superpowers/specs/2026-08-24-dense-handle-m0-results.md` (in the `homepage-hero-demo-3878ef` worktree — results are load-bearing conclusions, so they live with the specs, per the "if the session directory is gone, the specs carry the conclusions" rule)

- [ ] **Step 1: Write the results document**

Structure (fill with the actual measured numbers — no placeholders may survive):

```markdown
# M0 pricing probe — results

Date: 2026-08-24. Probe: `m0-probe.mjs` (session scratchpad, throwaway).
Machine load at run: <uptime output>. Fitness: all spreads ≤ 20%? <yes/no + worst>.

## Isolation numbers (median of 5, 2 warmups)

| section | median | spread |
|---|---|---|
| A1 numeric columnar scan → bitset | ... | ... |
| A2 string columnar scan → bitset | ... | ... |
| A3 xor + enumerate flips | ... | ... |
| A4 50k records-by-slot vecGet | ... | ... |
| A5 50k string-keyed Map.get (baseline) | ... | ... |
| B composed filter-commit equivalent | ... | ... |
| C streaming: per-commit chunk-COW (100 writes) | ...µs | ... |
| C2 whole-bitset clone | ... | ... |

## Read-across

- Replaced work (trace attribution, `filter-final-results.md`): 72.7ms.
- New-structure equivalent (overcounted — includes a survivors sort the real
  path does not perform): <B + A-sections as applicable>ms.
- Streaming regression check: per-commit COW cost <X>µs vs the HAMT's
  structural sharing — verdict on whether 60Hz streaming survives: <verdict>.
- Caveat: Node numbers; the precedent probe landed within 2ms of the browser,
  but browser certification is M7's job, not M0's.

## Go/no-go

<GO if the new-structure numbers make the spec's ~55–75ms window plausible,
i.e. new primitives total ≲ 15ms against the 72.7ms being replaced, and
per-commit streaming cost ≲ 500µs. Otherwise NO-GO with the specific
primitive that priced out, and a recommendation.>
```

- [ ] **Step 2: Commit**

```bash
cd /Users/blove/repos/pretable/.claude/worktrees/homepage-hero-demo-3878ef
git add docs/superpowers/specs/2026-08-24-dense-handle-m0-results.md
git commit -m "docs: M0 pricing probe results for the dense-handle core

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

Expected: clean commit on `blove/filter-fast-path`.
