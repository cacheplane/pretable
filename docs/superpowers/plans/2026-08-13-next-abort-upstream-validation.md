# Upstream Abort-Fix Validation Implementation Plan

> **COMPLETE — 2026-08-13.** Both PRs eliminate the error (0/0/0 vs a 28-42
> baseline) and both preserve render cancellation. Posted to
> [vercel/next.js#96704](https://github.com/vercel/next.js/issues/96704#issuecomment-5289212782);
> pretable #377 updated. Raw logs in `/Users/blove/repos/next-abort-results`.
>
> Two plan assumptions were wrong and are corrected in-place below: a `link:`ed
> Next build does not work (Turbopack will not compile outside the workspace
> root — copy the built `dist` over the installed package instead, proving the
> swap with a marker grep before and after), and `pnpm install` silently moves
> `^16.3.0` to 16.3.1, which would have made an arm partly a version bump.

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
NEXTSRC_B=/Users/blove/repos/next.js          # arm B, PR #96715
NEXTSRC_C=/Users/blove/repos/next.js-96717    # arm C, PR #96717
TWIN=/Users/blove/repos/next-abort-twin
RESULTS=/Users/blove/repos/next-abort-results
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
| `$TWIN/app/page.tsx` | Home route carrying a `prefetch={false}` link, so the RSC fetch happens on click |
| `$TWIN/app/slow/page.tsx` | Slow dynamic route that logs `RENDER-COMPLETED` only if the render actually finishes |
| `$TWIN/drive.mjs` | Drives a real client-router RSC navigation and hangs up mid-render |
| `$RESULTS/*.log` | Raw server logs, one per run, named by arm and run number |
| `$RESULTS/summary.md` | The table that becomes the upstream comment |

No file in `$PRETABLE` is modified by this plan.

---

## Task 1: Build the cancellation twin and prove it discriminates

**Revised after the first attempt failed its gate.** The original twin issued a
plain HTML `GET` and disconnected mid-render. On unmodified 16.3.0 that produced
`closed early: 0` and `RENDER-COMPLETED: 1` — it neither cancelled the render
nor reproduced the phenomenon at all. The twin had no discriminating power to
lend arms B and C, which would have scored identically whether or not the PRs
worked.

That is consistent with the source analysis: the RSC payload path pipes into a
PassThrough with a direct `res.close → pt.destroy()` link, while the HTML
document render's flight stream goes through a `.pipe()` chain of Transforms
where `destroy` does not propagate upstream. It also matches the proxy data from
the original investigation, where the aborted requests that produced errors were
overwhelmingly `?_rsc=` router requests, not document loads.

So the twin must abort a **client-router RSC navigation**, not a document load.
Rather than hand-forge RSC headers — a bare `RSC: 1` header 307s, because Next
also wants the router state tree — drive a real navigation with Playwright and
let the router issue its own request.

**The gate the original plan was missing:** a positive control on the *error*,
not just on the marker. The baseline must be shown to log `closed early` before
any arm's zero means anything.

**Files:**
- Create: `$TWIN/package.json`, `$TWIN/app/layout.tsx`, `$TWIN/app/page.tsx`, `$TWIN/app/slow/page.tsx`
- Create: `$TWIN/drive.mjs`

- [ ] **Step 1: Scaffold**

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

- [ ] **Step 2: Root layout**

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

- [ ] **Step 3: Home route with a non-prefetching link**

`app/page.tsx` is required: without a root route `next build` fails on Next's
auto-generated `/_global-error` with `Invariant: Expected workStore to be
initialized`. `prefetch={false}` is load-bearing — with prefetching on, the
router fetches `/slow` on hover or viewport entry and the render may already be
complete before the click, so the abort would land on nothing.

```bash
cat > $TWIN/app/page.tsx <<'EOF'
import Link from "next/link";

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<{ id?: string }>;
}) {
  // The id is threaded from the home URL into the link so each run's marker is
  // greppable on its own. Hardcoding it here would make every per-run grep
  // match nothing, and an absent marker is exactly what this twin reads as
  // "the render was cancelled" — a false pass.
  const { id = "nav" } = await searchParams;
  return (
    <main>
      <Link href={`/slow?id=${id}`} prefetch={false}>
        go slow
      </Link>
    </main>
  );
}
EOF
```

- [ ] **Step 4: The slow route**

The marker lives in a CHILD component rendered after the await, not in the
awaited function. `await sleep(); console.log()` would print even on an aborted
render, because aborting React does not cancel a pending JS promise — the timer
still fires. Putting the marker where React must choose to render it is what
makes it mean "the render continued".

```bash
cat > $TWIN/app/slow/page.tsx <<'EOF'
export const dynamic = "force-dynamic";

function Marker({ id }: { id: string }) {
  // Reached only if React continued the render after the await resolved.
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

- [ ] **Step 5: The driver**

```bash
cat > $TWIN/drive.mjs <<'EOF'
/**
 * Drive a real client-router RSC navigation, then hang up mid-render.
 *
 * Clicking a `prefetch={false}` Link makes the App Router issue its own RSC
 * request, with the router state tree headers Next requires. A hand-rolled
 * `RSC: 1` curl 307s instead of rendering, which is why this uses a browser.
 *
 * mode=complete lets the navigation finish (the marker's positive control).
 * mode=abort closes the context 1000ms in — inside the 3s render.
 */
import { chromium } from "@playwright/test";

const mode = process.argv[2] ?? "abort";
const id = process.argv[3] ?? "nav";

const browser = await chromium.launch();
const ctx = await browser.newContext();
const page = await ctx.newPage();
await page.goto(`http://localhost:3310/?id=${id}`, { waitUntil: "load" });
await page.getByRole("link", { name: "go slow" }).click({ noWaitAfter: true });

if (mode === "abort") {
  await new Promise((r) => setTimeout(r, 1000));
} else {
  await page.waitForURL("**/slow**", { timeout: 15000 });
  await new Promise((r) => setTimeout(r, 4000));
}
await ctx.close();
await browser.close();
EOF
```

Run it with the pretable website's Playwright, which is already installed:

```bash
cd $PRETABLE/apps/website && node $TWIN/drive.mjs <mode> <id>
```

- [ ] **Step 6: Install, build, start**

```bash
cd $TWIN && pnpm install && pnpm build
mkdir -p $RESULTS
(pnpm start > $RESULTS/twin-baseline.log 2>&1 &)
sleep 6
```

- [ ] **Step 7: GATE A — the marker must be able to fire**

```bash
cd $PRETABLE/apps/website && node $TWIN/drive.mjs complete positive
sleep 2
grep -c "RENDER-COMPLETED positive" $RESULTS/twin-baseline.log
```

Expected: `1`. If `0`, the marker never fires and its later absence proves
nothing. STOP and report.

- [ ] **Step 8: GATE B — the baseline must reproduce the ERROR**

This is the gate the first version of this plan lacked, and its absence is why
the first attempt wasted a task.

```bash
cd $PRETABLE/apps/website && node $TWIN/drive.mjs abort aborted
sleep 6
echo "started:      $(grep -c 'RENDER-STARTED aborted' $RESULTS/twin-baseline.log)"
echo "completed:    $(grep -c 'RENDER-COMPLETED aborted' $RESULTS/twin-baseline.log)"
echo "closed-early: $(grep -c 'closed early' $RESULTS/twin-baseline.log)"
```

Expected: `started: 1`, `completed: 0`, `closed-early: 1`.

- `closed-early: 0` means the twin still does not reproduce the phenomenon.
  STOP — do not adjust the marker, the problem is the request path. Report what
  the driver actually did (add `page.on("request")` logging of `_rsc` URLs) so
  the next attempt starts from evidence rather than another guess.
- `completed: 1` with `closed-early: 1` means the error reproduces but the
  render is not cancelled — surprising, and a finding worth reporting on its
  own. STOP and report.

- [ ] **Step 9: Record the baseline and commit the twin**

Write only what was observed. The previous attempt correctly refused to run a
commit whose message asserted a result that had not occurred; keep that
standard.

```bash
cd $TWIN && git init -q 2>/dev/null; git add -A
git commit -q -F - <<EOF
Minimal repro: client-aborted RSC navigation on Next 16.3.0

/slow holds a 3s async server component whose completion marker lives in a
child component, so the marker means "React continued the render", not "the
timer fired". drive.mjs clicks a prefetch={false} Link so the App Router issues
a real RSC request, then closes the context 1000ms in.

Observed on 16.3.0 (fill in from Step 8 before committing):
  RENDER-STARTED aborted:   <n>
  RENDER-COMPLETED aborted: <n>
  closed early:             <n>
EOF
kill $(lsof -tiTCP:3310 -sTCP:LISTEN) 2>/dev/null
```

Replace each `<n>` with the observed value. Committing a placeholder or an
unobserved result is a failure.

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
  kill $(lsof -tiTCP:3199 -sTCP:LISTEN) 2>/dev/null; sleep 2
  echo "load before run $run: $(uptime | sed 's/.*averages://')" | tee -a $RESULTS/armA-meta.txt
  (pnpm exec next start -p 3199 2>&1 | perl -ne 'BEGIN{$|=1} printf "%.3f %s", time, $_' > $RESULTS/armA-run$run.log &)
  for i in $(seq 1 45); do curl -sf -o /dev/null http://localhost:3199/ && break; sleep 1; done
  BASE_URL=http://localhost:3199 pnpm exec playwright test --workers=1 2>&1 | tail -3 | tee -a $RESULTS/armA-meta.txt
  sleep 4
  echo "run $run errors: $(grep -c 'closed early' $RESULTS/armA-run$run.log)" | tee -a $RESULTS/armA-meta.txt
done
kill $(lsof -tiTCP:3199 -sTCP:LISTEN) 2>/dev/null
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
git clone --filter=blob:none https://github.com/vercel/next.js.git $NEXTSRC_B
cd $NEXTSRC_B
git fetch origin pull/96715/head:pr-96715
git checkout pr-96715
git log --oneline -3
```

- [ ] **Step 2: Confirm the diff is what the PR claims**

```bash
cd $NEXTSRC_B && git diff --stat $(git merge-base HEAD origin/canary) HEAD
```

Expected: 7 files changed, ~87 insertions, 0 deletions. Read the diff in
`packages/next/src/server/` before building — if it does not match the PR
description, record that as a finding.

- [ ] **Step 3: Install and build the JS packages only**

`pnpm --filter next build` does NOT work: pnpm's filter does not build workspace
dependencies, so it fails in ~3s with `next__polyfill_module failed because
Cannot find module .../@next/polyfill-module/dist/polyfill-module.js`. Turbo's
`build` task has `dependsOn: ["^build"]` and does build them first.

The repo pins `pnpm@10.33.0` while this machine has 10.12.1, so use
`corepack pnpm` throughout.

```bash
cd $NEXTSRC_B && corepack pnpm install --frozen-lockfile
corepack pnpm turbo run build --filter=next --remote-cache-timeout 60
```

Expected: `packages/next/dist/` is populated. Measured on arm B: install 56s,
build 63s.

**Gate — the spec's named risk, which did NOT materialise on arm B.** The
postinstall (`scripts/install-native.mjs`) downloads a prebuilt
`@next/swc-darwin-arm64`; no `cargo`/`rustc` runs. If a later arm does start
compiling Rust and cannot finish within ~30 minutes, take the documented
fallback: apply that PR's equivalent change to `$PRETABLE/node_modules` via
`pnpm patch`, and record in `$RESULTS/summary.md` — in the words that will
appear upstream — that the mechanism was validated and the PR's own code was
not.

Verify the bindings actually load rather than trusting an absence of warnings:

```bash
cd $NEXTSRC_B/packages/next && node -e "
require('./dist/build/swc').loadBindings().then(b =>
  console.log('bindings OK; turbopack present:', !!b.turbo));
"
```

- [ ] **Step 4: Link the built Next into the website**

```bash
cd $PRETABLE
cp package.json /tmp/root-package.json.bak
node -e "
const fs=require('fs');const p=JSON.parse(fs.readFileSync('package.json','utf8'));
p.pnpm=p.pnpm||{};p.pnpm.overrides=p.pnpm.overrides||{};
p.pnpm.overrides.next='link:$NEXTSRC_B/packages/next';
fs.writeFileSync('package.json',JSON.stringify(p,null,2)+'\n');
"
pnpm install
node -e "console.log(require.resolve('next/package.json'))"
```

Expected: the resolved path is under `$NEXTSRC_B`.

- [ ] **Step 5: Verify the arm is green BEFORE measuring**

```bash
cd $PRETABLE/apps/website && pnpm exec next build 2>&1 | tail -5
```

Expected: build succeeds.

**Gate:** if the build fails, this arm produces a defect report, not a number.
Record the failure verbatim in `$RESULTS/summary.md` and move to Task 5.

**Arm B, as built and verified (2026-08-13):** branch `pr-96715` at `e3a23e0294`,
merge-base `ab09c1f4b4`, 7 files / +87 / −0 — confirmed to the line. The
behavioural change is 12 lines in
`packages/next/src/server/app-render/stream-ops.node.ts`; the other six files are
new e2e fixtures. It registers a `close` listener on the PassThrough **before**
`pipeable.pipe(pt)`, so Node fires it ahead of React's own close handler and
calls `pipeable.abort(new ResponseAborted())` — a reason `isAbortError`
recognises. An `if (!pt.writableEnded)` guard leaves a normally-finished render
untouched.

Two facts confirmed in source that make the fix load-bearing rather than
redundant, and that belong in the upstream write-up: `renderToNodeFlightStream`
already has an `if (signal)` abort block, but its caller's signal is gated on
`__NEXT_DEV_SERVER`, which the prod webpack config inlines as `''` — so in
production that block is dead and the new handler is the only mechanism. And
`__NEXT_USE_NODE_STREAMS` is inlined `true` for the `app` bundle, so the Node
path is what serves App Router in production.

The patch survives into the built output: `writableEnded` appears in
`dist/server/app-render/stream-ops.node.js` and in both `app-page.runtime.prod.js`
and `app-page-turbo.runtime.prod.js`.

**Correction to arm B's recorded finding, from arm C's check.** `stream-ops.node.ts`
is NOT byte-identical between v16.3.0 and the merge-base — there is a 2-line
drift (`isStaticGeneration` → `waitForAllReady` in `continueFizzStream`). It is
unrelated to the abort path and does not weaken the conclusion, but the upstream
write-up must say "the patched region is identical", never "the file is".

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
  kill $(lsof -tiTCP:3199 -sTCP:LISTEN) 2>/dev/null; sleep 2
  echo "load before run $run: $(uptime | sed 's/.*averages://')" | tee -a $RESULTS/armB-meta.txt
  (pnpm exec next start -p 3199 2>&1 | perl -ne 'BEGIN{$|=1} printf "%.3f %s", time, $_' > $RESULTS/armB-run$run.log &)
  for i in $(seq 1 45); do curl -sf -o /dev/null http://localhost:3199/ && break; sleep 1; done
  BASE_URL=http://localhost:3199 pnpm exec playwright test --workers=1 2>&1 | tail -3 | tee -a $RESULTS/armB-meta.txt
  sleep 4
  echo "run $run errors: $(grep -c 'closed early' $RESULTS/armB-run$run.log)" | tee -a $RESULTS/armB-meta.txt
done
kill $(lsof -tiTCP:3199 -sTCP:LISTEN) 2>/dev/null
```

Expected if the PR works: `112 passed` each run, error count `0`.

- [ ] **Step 2: Run the cancellation twin against this build**

`drive.mjs` imports `@playwright/test`, which Node resolves from the importing
FILE's directory — a `cd` cannot lend it. Task 1 symlinked the website's copy
into `$TWIN/node_modules/@playwright/test`; confirm it still resolves before
relying on a result.

```bash
cd $TWIN
node -e "
const fs=require('fs');const p=JSON.parse(fs.readFileSync('package.json','utf8'));
p.pnpm={overrides:{next:'link:$NEXTSRC_B/packages/next'}};
fs.writeFileSync('package.json',JSON.stringify(p,null,2)+'\n');
"
pnpm install && pnpm build
(pnpm start > $RESULTS/twin-armB.log 2>&1 &)
sleep 5
node $TWIN/drive.mjs complete positive
sleep 2
node $TWIN/drive.mjs abort aborted
sleep 5
echo "positive marker: $(grep -c 'RENDER-COMPLETED positive' $RESULTS/twin-armB.log)"
echo "aborted started: $(grep -c 'RENDER-STARTED aborted' $RESULTS/twin-armB.log)"
echo "aborted completed: $(grep -c 'RENDER-COMPLETED aborted' $RESULTS/twin-armB.log)"
echo "closed early: $(grep -c 'closed early' $RESULTS/twin-armB.log)"
kill $(lsof -tiTCP:3310 -sTCP:LISTEN) 2>/dev/null
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

Arm C uses its OWN clone. An earlier draft of this step said `cd $NEXTSRC` — a
variable that does not exist — and omitted the clone. Run from a shell where
Task 3 had been executed, that would have checked #96717 out on top of arm B's
working tree and destroyed it, silently, with both arms then measuring the same
build.

- [x] **Step 1: Clone, check out and inspect the PR** — done 2026-08-13

```bash
git clone --filter=blob:none https://github.com/vercel/next.js.git $NEXTSRC_C
cd $NEXTSRC_C
git fetch origin pull/96717/head:pr-96717
git checkout pr-96717
git diff --stat $(git merge-base HEAD origin/canary) HEAD
```

Expected — an equality gate, not an approximation; it held to the line:
**4 files changed, 95 insertions(+), 12 deletions(-)**.

Observed: `pr-96717` at `836cdfbc43`, merge-base `ab09c1f4b4` (the same
merge-base as arm B), base version `16.3.1-canary.3`, 161 commits behind canary.

- [ ] **Step 2: Rebuild**

```bash
cd $NEXTSRC_C && corepack pnpm install --frozen-lockfile
corepack pnpm turbo run build --filter=next --remote-cache-timeout 60
```

`pnpm --filter next build` fails here for the same reason as in Task 3 — it does
not build workspace dependencies.

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
  kill $(lsof -tiTCP:3199 -sTCP:LISTEN) 2>/dev/null; sleep 2
  echo "load before run $run: $(uptime | sed 's/.*averages://')" | tee -a $RESULTS/armC-meta.txt
  (pnpm exec next start -p 3199 2>&1 | perl -ne 'BEGIN{$|=1} printf "%.3f %s", time, $_' > $RESULTS/armC-run$run.log &)
  for i in $(seq 1 45); do curl -sf -o /dev/null http://localhost:3199/ && break; sleep 1; done
  BASE_URL=http://localhost:3199 pnpm exec playwright test --workers=1 2>&1 | tail -3 | tee -a $RESULTS/armC-meta.txt
  sleep 4
  echo "run $run errors: $(grep -c 'closed early' $RESULTS/armC-run$run.log)" | tee -a $RESULTS/armC-meta.txt
done
kill $(lsof -tiTCP:3199 -sTCP:LISTEN) 2>/dev/null
```

- [ ] **Step 5: Run the cancellation twin against this build**

```bash
cd $TWIN && pnpm install && pnpm build
(pnpm start > $RESULTS/twin-armC.log 2>&1 &)
sleep 5
node $TWIN/drive.mjs complete positive
sleep 2
node $TWIN/drive.mjs abort aborted
sleep 5
echo "positive marker: $(grep -c 'RENDER-COMPLETED positive' $RESULTS/twin-armC.log)"
echo "aborted started: $(grep -c 'RENDER-STARTED aborted' $RESULTS/twin-armC.log)"
echo "aborted completed: $(grep -c 'RENDER-COMPLETED aborted' $RESULTS/twin-armC.log)"
echo "closed early: $(grep -c 'closed early' $RESULTS/twin-armC.log)"
kill $(lsof -tiTCP:3310 -sTCP:LISTEN) 2>/dev/null
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
kill $(lsof -tiTCP:3199 -tiTCP:3310 -sTCP:LISTEN) 2>/dev/null
cd $PRETABLE && git status --short
```

Expected: clean. `$NEXTSRC_B`, `$NEXTSRC_C` and `$TWIN` may stay for future re-validation.

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
