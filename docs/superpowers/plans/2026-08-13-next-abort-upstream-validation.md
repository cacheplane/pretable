# Upstream Abort-Fix Validation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Produce evidence on [vercel/next.js#96704](https://github.com/vercel/next.js/issues/96704) showing whether PRs [#96715](https://github.com/vercel/next.js/pull/96715) and [#96717](https://github.com/vercel/next.js/pull/96717) eliminate the `The destination stream closed early.` log noise under a real 112-test browser workload **without** silently breaking render cancellation.

**Architecture:** Three measurement arms (baseline, PR #96715, PR #96717). Each arm is built, verified green, then measured twice: the pretable website e2e suite for scale numbers, and a purpose-built "cancellation twin" app that fails loudly if a fix wins by no longer cancelling renders. Nothing is posted upstream without explicit approval.

**Tech Stack:** Next.js 16.3.0 / React 19.2.8, pnpm workspaces, Playwright (Chromium + WebKit), Node 22.

**Spec:** `docs/superpowers/specs/2026-08-13-next-abort-upstream-validation-design.md`

---

## Path variables

Used throughout. Set these once per shell.

```bash
PRETABLE=/Users/blove/repos/pretable/.claude/worktrees/artifact-continuation-676f46
NEXTSRC=/Users/blove/repos/next.js
TWIN=/Users/blove/repos/next-abort-twin
RESULTS=$PRETABLE/../../../next-abort-results
```

`TWIN` and `NEXTSRC` live outside the pretable repo deliberately — neither is
pretable source and neither may be committed to it. `RESULTS` holds raw logs so
a number can always be traced back to the run that produced it.

---

## File Structure

| Path | Responsibility |
| --- | --- |
| `$TWIN/package.json` | Minimal Next app; the shareable upstream repro |
| `$TWIN/app/layout.tsx` | Required root layout, nothing more |
| `$TWIN/app/slow/page.tsx` | Slow dynamic route that logs `RENDER-COMPLETED` only if the render actually finishes |
| `$TWIN/probe.mjs` | Issues a request and disconnects mid-render, deterministically |
| `$TWIN/run-twin.sh` | Runs the twin protocol against a given Next build, prints a verdict |
| `$RESULTS/*.log` | Raw server logs, one per run, named by arm and run number |
| `$RESULTS/summary.md` | The table that becomes the upstream comment |

No file in `$PRETABLE` is modified by this plan.

---

## Task 1: Build the cancellation twin and prove it can fire

The twin is the only check that separates "correctly classified the abort" from
"stopped cancelling renders". Build it first, against the **unmodified** Next,
because its discriminating power must be established before any PR is measured.

**Files:**
- Create: `$TWIN/package.json`
- Create: `$TWIN/app/layout.tsx`
- Create: `$TWIN/app/slow/page.tsx`
- Create: `$TWIN/probe.mjs`

- [ ] **Step 1: Scaffold the twin app**

```bash
mkdir -p $TWIN/app/slow && cd $TWIN
cat > package.json <<'EOF'
{
  "name": "next-abort-twin",
  "private": true,
  "scripts": { "build": "next build", "start": "next start -p 3310" },
  "dependencies": {
    "next": "16.3.0",
    "react": "19.2.8",
    "react-dom": "19.2.8"
  }
}
EOF
```

- [ ] **Step 2: Write the root layout**

```bash
cat > $TWIN/app/layout.tsx <<'EOF'
export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
EOF
```

- [ ] **Step 3: Write the slow route**

The marker is emitted by a **child component rendered after the await**, not by
the awaited function itself. A bare `await sleep(); console.log()` would print
even on an aborted render, because aborting React does not cancel a pending JS
promise — the timer still fires and the line still runs. Putting the marker in a
component React must choose to render is what makes the signal mean "the render
continued", not "the timer elapsed".

```bash
cat > $TWIN/app/slow/page.tsx <<'EOF'
export const dynamic = "force-dynamic";

function Marker({ id }: { id: string }) {
  // Rendered only if React continued the render after the await resolved.
  // If the request was aborted, React drops this task and this never runs.
  console.log(`RENDER-COMPLETED ${id}`);
  return <p>done {id}</p>;
}

async function Slow({ id }: { id: string }) {
  await new Promise((resolve) => setTimeout(resolve, 3000));
  return <Marker id={id} />;
}

export default async function SlowPage({
  searchParams,
}: {
  searchParams: Promise<{ id?: string }>;
}) {
  const { id = "none" } = await searchParams;
  console.log(`RENDER-STARTED ${id}`);
  return (
    <main>
      <Slow id={id} />
    </main>
  );
}
EOF
```

- [ ] **Step 4: Write the disconnect probe**

```bash
cat > $TWIN/probe.mjs <<'EOF'
/**
 * Request /slow and hang up mid-render.
 *
 * `disconnectMs` must land between RENDER-STARTED and the 3s completion, so the
 * socket closes while React is genuinely mid-render. 1000ms gives a wide margin
 * on both sides even on a loaded machine.
 */
import http from "node:http";

const id = process.argv[2] ?? "probe";
const mode = process.argv[3] ?? "abort"; // "abort" | "complete"
const disconnectMs = 1000;

const req = http.get(
  { host: "localhost", port: 3310, path: `/slow?id=${id}` },
  (res) => {
    res.resume();
    res.on("end", () => process.exit(0));
  },
);

if (mode === "abort") {
  setTimeout(() => {
    req.destroy();
    process.exit(0);
  }, disconnectMs);
}
EOF
```

- [ ] **Step 5: Install and build the twin**

```bash
cd $TWIN && pnpm install && pnpm build
```

Expected: build succeeds, `/slow` listed as `ƒ` (dynamic).

- [ ] **Step 6: Prove the marker CAN fire (positive twin)**

A check that never fires proves nothing. This is the step that makes a later
absence meaningful.

```bash
mkdir -p $RESULTS
cd $TWIN && (pnpm start > $RESULTS/twin-baseline.log 2>&1 &)
sleep 5
node probe.mjs positive complete
sleep 2
grep -c "RENDER-COMPLETED positive" $RESULTS/twin-baseline.log
```

Expected: `1`.

**Gate:** if this prints `0`, the twin is broken — stop and fix it before going
further. Everything downstream is meaningless without it.

- [ ] **Step 7: Prove the marker is ABSENT on an aborted baseline render**

```bash
cd $TWIN && node probe.mjs aborted abort
sleep 5
echo "started:   $(grep -c 'RENDER-STARTED aborted' $RESULTS/twin-baseline.log)"
echo "completed: $(grep -c 'RENDER-COMPLETED aborted' $RESULTS/twin-baseline.log)"
echo "closed-early: $(grep -c 'closed early' $RESULTS/twin-baseline.log)"
```

Expected: `started: 1`, `completed: 0`, `closed-early: 1`.

**Gate:** if `completed` is `1`, the twin cannot distinguish a cancelled render
from a completed one and the whole check is vacuous. Do not proceed. Record the
finding and switch to the documented alternative: replace the console marker
with a module-level counter incremented in `Marker` and exposed by a second
route (`app/count/route.ts` returning the counter), then compare counts instead
of log lines. Re-run Steps 6 and 7 against that version before continuing.

- [ ] **Step 8: Record the baseline twin result and commit the twin**

```bash
cd $TWIN && git init -q && git add -A
git commit -q -m "Minimal repro: client-aborted RSC render on Next 16.3.0

/slow holds a 3s async server component whose completion marker lives in a
child component, so the marker means 'React continued the render', not 'the
timer fired'. probe.mjs disconnects at 1000ms.

Baseline 16.3.0: RENDER-STARTED yes, RENDER-COMPLETED no, one
'The destination stream closed early.' — the render WAS cancelled and was
still reported as a render error."
pkill -f "next start -p 3310"
```

---

## Task 2: Record the baseline arm (A)

**Files:**
- Create: `$RESULTS/armA-run{1,2,3}.log`

- [ ] **Step 1: Confirm the website is on unmodified Next 16.3.0**

```bash
cd $PRETABLE && node -e "console.log(require('next/package.json').version)"
```

Expected: `16.3.0`.

- [ ] **Step 2: Build the website**

```bash
cd $PRETABLE && pnpm -r --filter './packages/*' build && cd apps/website && pnpm exec next build
```

Expected: build completes, no errors.

- [ ] **Step 3: Run the suite three times, recording load and errors**

```bash
cd $PRETABLE/apps/website
for run in 1 2 3; do
  pkill -f "next start -p 3199" 2>/dev/null; sleep 2
  echo "load before run $run: $(uptime | sed 's/.*averages://')" | tee -a $RESULTS/armA-meta.txt
  (pnpm exec next start -p 3199 2>&1 | perl -ne 'BEGIN{$|=1} printf "%.3f %s", time, $_' > $RESULTS/armA-run$run.log &)
  for i in $(seq 1 45); do curl -sf -o /dev/null http://localhost:3199/ && break; sleep 1; done
  BASE_URL=http://localhost:3199 pnpm exec playwright test --workers=1 2>&1 | tail -3 | tee -a $RESULTS/armA-meta.txt
  sleep 4
  echo "run $run errors: $(grep -c 'closed early' $RESULTS/armA-run$run.log)" | tee -a $RESULTS/armA-meta.txt
done
pkill -f "next start -p 3199" 2>/dev/null
```

Expected: each run reports `112 passed`, and an error count in the 30–50 range.

**Gate:** any run that does not report `112 passed` is discarded and re-run. A
number from a red suite is not data.

---

## Task 3: Clone Next and build PR #96715 (arm B)

**Files:**
- Create: `$NEXTSRC` (clone)

- [ ] **Step 1: Clone and check out the PR**

```bash
git clone --filter=blob:none https://github.com/vercel/next.js.git $NEXTSRC
cd $NEXTSRC
git fetch origin pull/96715/head:pr-96715
git checkout pr-96715
git log --oneline -3
```

- [ ] **Step 2: Confirm the diff is what the PR claims**

```bash
cd $NEXTSRC && git diff --stat $(git merge-base HEAD origin/canary) HEAD
```

Expected: 7 files changed, ~87 insertions, 0 deletions. Read the diff in
`packages/next/src/server/` before building — if it does not match the PR
description, record that as a finding.

- [ ] **Step 3: Install and build the JS packages only**

```bash
cd $NEXTSRC && pnpm install --frozen-lockfile
pnpm --filter next build
```

Expected: `packages/next/dist/` is populated.

**Gate — the spec's named risk.** If this needs a Rust/Turbopack native build
that does not complete within ~30 minutes, stop and take the documented
fallback: skip Tasks 3–5's source builds and instead apply each PR's equivalent
change to `$PRETABLE/node_modules` via `pnpm patch`, recording in
`$RESULTS/summary.md` — in the words that will appear upstream — that the
mechanism was validated and the PR's own code was not.

- [ ] **Step 4: Link the built Next into the website**

```bash
cd $PRETABLE
cp package.json /tmp/root-package.json.bak
node -e "
const fs=require('fs');const p=JSON.parse(fs.readFileSync('package.json','utf8'));
p.pnpm=p.pnpm||{};p.pnpm.overrides=p.pnpm.overrides||{};
p.pnpm.overrides.next='link:$NEXTSRC/packages/next';
fs.writeFileSync('package.json',JSON.stringify(p,null,2)+'\n');
"
pnpm install
node -e "console.log(require.resolve('next/package.json'))"
```

Expected: the resolved path is under `$NEXTSRC`.

- [ ] **Step 5: Verify the arm is green BEFORE measuring**

```bash
cd $PRETABLE/apps/website && pnpm exec next build 2>&1 | tail -5
```

Expected: build succeeds.

**Gate:** if the build fails, this arm produces a defect report, not a number.
Record the failure verbatim in `$RESULTS/summary.md` and move to Task 5.

- [ ] **Step 6: Commit the results scaffold**

```bash
cd $RESULTS && git init -q 2>/dev/null; git add -A
git commit -q -m "arm B: PR #96715 built and linked" || true
```

---

## Task 4: Measure arm B

**Files:**
- Create: `$RESULTS/armB-run{1,2,3}.log`, `$RESULTS/twin-armB.log`

- [ ] **Step 1: Run the suite three times**

```bash
cd $PRETABLE/apps/website
for run in 1 2 3; do
  pkill -f "next start -p 3199" 2>/dev/null; sleep 2
  echo "load before run $run: $(uptime | sed 's/.*averages://')" | tee -a $RESULTS/armB-meta.txt
  (pnpm exec next start -p 3199 2>&1 | perl -ne 'BEGIN{$|=1} printf "%.3f %s", time, $_' > $RESULTS/armB-run$run.log &)
  for i in $(seq 1 45); do curl -sf -o /dev/null http://localhost:3199/ && break; sleep 1; done
  BASE_URL=http://localhost:3199 pnpm exec playwright test --workers=1 2>&1 | tail -3 | tee -a $RESULTS/armB-meta.txt
  sleep 4
  echo "run $run errors: $(grep -c 'closed early' $RESULTS/armB-run$run.log)" | tee -a $RESULTS/armB-meta.txt
done
pkill -f "next start -p 3199" 2>/dev/null
```

Expected if the PR works: `112 passed` each run, error count `0`.

- [ ] **Step 2: Run the cancellation twin against this build**

```bash
cd $TWIN
node -e "
const fs=require('fs');const p=JSON.parse(fs.readFileSync('package.json','utf8'));
p.pnpm={overrides:{next:'link:$NEXTSRC/packages/next'}};
fs.writeFileSync('package.json',JSON.stringify(p,null,2)+'\n');
"
pnpm install && pnpm build
(pnpm start > $RESULTS/twin-armB.log 2>&1 &)
sleep 5
node probe.mjs positive complete
sleep 2
node probe.mjs aborted abort
sleep 5
echo "positive marker: $(grep -c 'RENDER-COMPLETED positive' $RESULTS/twin-armB.log)"
echo "aborted started: $(grep -c 'RENDER-STARTED aborted' $RESULTS/twin-armB.log)"
echo "aborted completed: $(grep -c 'RENDER-COMPLETED aborted' $RESULTS/twin-armB.log)"
echo "closed early: $(grep -c 'closed early' $RESULTS/twin-armB.log)"
pkill -f "next start -p 3310"
```

Expected for a **correct** fix: positive `1`, aborted started `1`, aborted
completed `0`, closed early `0`.

A result of aborted completed `1` means the fix eliminated the error by no
longer cancelling the render. **That is a finding to report, not a pass.**

- [ ] **Step 3: Record arm B in the summary**

```bash
cat >> $RESULTS/summary.md <<'EOF'
## Arm B — PR #96715

| metric | value |
| --- | --- |
| suite | (fill from armB-meta.txt) |
| `closed early` per run | (fill) |
| twin: positive marker fires | (fill) |
| twin: render still cancelled | (fill) |
EOF
```

Replace each `(fill)` with the observed value before committing. A `(fill)`
left in the file is a plan failure.

---

## Task 5: Build and measure PR #96717 (arm C)

**Files:**
- Create: `$RESULTS/armC-run{1,2,3}.log`, `$RESULTS/twin-armC.log`

- [ ] **Step 1: Check out and inspect the PR**

```bash
cd $NEXTSRC
git fetch origin pull/96717/head:pr-96717
git checkout pr-96717
git diff --stat $(git merge-base HEAD origin/canary) HEAD
```

Expected: 4 files changed, ~95 insertions, ~12 deletions.

- [ ] **Step 2: Rebuild**

```bash
cd $NEXTSRC && pnpm --filter next build
```

- [ ] **Step 3: Rebuild the website against it and verify green**

```bash
cd $PRETABLE && pnpm install
cd apps/website && pnpm exec next build 2>&1 | tail -5
```

Expected: build succeeds. Same gate as Task 3 Step 5.

- [ ] **Step 4: Run the suite three times**

Identical to Task 4 Step 1, with `armB` replaced by `armC` throughout:

```bash
cd $PRETABLE/apps/website
for run in 1 2 3; do
  pkill -f "next start -p 3199" 2>/dev/null; sleep 2
  echo "load before run $run: $(uptime | sed 's/.*averages://')" | tee -a $RESULTS/armC-meta.txt
  (pnpm exec next start -p 3199 2>&1 | perl -ne 'BEGIN{$|=1} printf "%.3f %s", time, $_' > $RESULTS/armC-run$run.log &)
  for i in $(seq 1 45); do curl -sf -o /dev/null http://localhost:3199/ && break; sleep 1; done
  BASE_URL=http://localhost:3199 pnpm exec playwright test --workers=1 2>&1 | tail -3 | tee -a $RESULTS/armC-meta.txt
  sleep 4
  echo "run $run errors: $(grep -c 'closed early' $RESULTS/armC-run$run.log)" | tee -a $RESULTS/armC-meta.txt
done
pkill -f "next start -p 3199" 2>/dev/null
```

- [ ] **Step 5: Run the cancellation twin against this build**

```bash
cd $TWIN && pnpm install && pnpm build
(pnpm start > $RESULTS/twin-armC.log 2>&1 &)
sleep 5
node probe.mjs positive complete
sleep 2
node probe.mjs aborted abort
sleep 5
echo "positive marker: $(grep -c 'RENDER-COMPLETED positive' $RESULTS/twin-armC.log)"
echo "aborted started: $(grep -c 'RENDER-STARTED aborted' $RESULTS/twin-armC.log)"
echo "aborted completed: $(grep -c 'RENDER-COMPLETED aborted' $RESULTS/twin-armC.log)"
echo "closed early: $(grep -c 'closed early' $RESULTS/twin-armC.log)"
pkill -f "next start -p 3310"
```

- [ ] **Step 6: Restore the website to unmodified Next**

Leaving a `link:` override in `package.json` would silently poison every later
session in this repo.

```bash
cd $PRETABLE && cp /tmp/root-package.json.bak package.json && pnpm install
node -e "console.log(require.resolve('next/package.json'))"
git status --short
```

Expected: resolved path is under `node_modules/.pnpm/next@16.3.0…`, and
`git status` is clean.

---

## Task 6: Draft the upstream comment

**Files:**
- Create: `$RESULTS/upstream-comment.md`

- [ ] **Step 1: Fill the summary table**

Every `(fill)` in `$RESULTS/summary.md` is replaced with an observed value. Any
arm that did not build or did not pass is written up as a defect, not omitted.

- [ ] **Step 2: Write the comment**

It must contain, in this order: what was measured and on what; the baseline
range; the causal control (proxy: 111 disconnects → 40 errors; absorbed → 0);
per-arm results including the cancellation twin; the source-level proof that a
completed render provably cannot log this; and any defect found. It must state
plainly if the fallback was taken and that the PR's own code was therefore not
what ran.

It must **not** recommend one PR over the other on style, speculate about
maintainer intent, or claim anything not in `$RESULTS`.

- [ ] **Step 3: Link the shareable repro**

Include the `$TWIN` app inline (it is four short files) so anyone can reproduce
without cloning anything of ours.

---

## Task 7: Approval gate — do not skip

- [ ] **Step 1: Bring the drafted comment to Brian**

Present `$RESULTS/upstream-comment.md` in full, with the summary table.

- [ ] **Step 2: Post only on explicit approval**

Posting to vercel/next.js is outward-facing and irreversible in practice. Post
only after Brian approves the exact text, and only to the target he approves
(issue #96704 versus the individual PRs).

```bash
gh issue comment 96704 --repo vercel/next.js --body-file $RESULTS/upstream-comment.md
```

- [ ] **Step 3: Update pretable #377 with the outcome**

```bash
cd $PRETABLE && gh issue comment 377 --body "Validated the upstream PRs against our suite; see <link to upstream comment>."
```

- [ ] **Step 4: Clean up**

```bash
pkill -f "next start" 2>/dev/null
cd $PRETABLE && git status --short
```

Expected: clean. `$NEXTSRC` and `$TWIN` may stay for future re-validation.

---

## Self-review notes

- **Spec coverage:** three arms (Tasks 2–5), measurement protocol with load and
  green-gate (Tasks 2–5), cancellation twin including its own positive-control
  gate (Task 1), deliverable comment (Task 6), approval gate (Task 7), the
  build-fallback risk (Task 3 Step 3), the restore-Next risk (Task 5 Step 6).
- **Known unknown, deliberately left as a gate rather than an assumption:**
  whether React declines to render `Marker` after an abort. Task 1 Step 7 tests
  exactly that against the baseline and carries a documented alternative, so a
  wrong guess is caught in the first task instead of silently invalidating every
  later number.
