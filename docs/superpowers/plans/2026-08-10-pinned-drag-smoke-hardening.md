# Pinned-column drag smoke hardening implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the existing right-pinned column drag smoke test prove drag engagement and recover from a missed initial press without relying on Playwright's whole-test retry.

**Architecture:** Change only the existing Playwright test. Reuse the adjacent three-attempt, freshly remeasured grab loop and the existing reorder ghost as the engagement signal; after engagement, freshly measure the pinned destination and keep the drop plus behavioral assertions single-shot. No product code, helper API, timeout, global retry, or release package changes.

**Tech Stack:** TypeScript, Playwright, pnpm workspaces, Next.js production server, Git, GitHub Actions.

---

## File map

| File                                                                      | Responsibility                                                                                                                                                       |
| ------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/website/e2e/smoke.spec.ts`                                          | Add bounded source-grab retries, explicit ghost engagement proof, pointer cleanup, and post-engagement destination measurement to the existing pinned-drop scenario. |
| `docs/superpowers/specs/2026-08-10-pinned-drag-smoke-hardening-design.md` | Approved behavior and verification contract; no further content changes are expected during implementation.                                                          |
| `docs/superpowers/plans/2026-08-10-pinned-drag-smoke-hardening.md`        | This execution checklist and exact verification commands.                                                                                                            |

No Changeset is required: the branch changes only an end-to-end test and internal planning documentation, with no packaged runtime, API, or published documentation change.

### Task 1: Synchronize the branch and prepare an isolated production smoke target

**Files:**

- Verify only: `apps/website/e2e/smoke.spec.ts`
- Verify only: `apps/website/e2e/helpers.ts:175-215`
- Verify only: `apps/website/playwright.config.ts`

- [ ] **Step 1: Confirm the branch is clean and fetch current upstream state**

Run:

```bash
git status --short --branch
git fetch --prune origin
git rev-list --left-right --count origin/main...HEAD
```

Expected: the worktree is clean. Record the ahead/behind count before changing history.

- [ ] **Step 2: Rebase the unpushed follow-up commits onto current `origin/main`**

Run:

```bash
git rebase origin/main
git status --short --branch
git merge-base --is-ancestor origin/main HEAD
git rev-list --left-right --count origin/main...HEAD
```

Expected: rebase succeeds without conflicts, the worktree is clean, the ancestry check exits 0, and the branch is behind 0. Stop and resolve scope with the user if upstream changed `apps/website/e2e/smoke.spec.ts` in the target test or materially invalidated the approved design.

- [ ] **Step 3: Record the browser-artifact baseline and choose a free port**

Run:

```bash
set -euo pipefail
if lsof -nP -iTCP:43193 -sTCP:LISTEN; then exit 1; fi
test ! -e /tmp/pretable-pinned-drag-status.before
git status --short > /tmp/pretable-pinned-drag-status.before
test ! -s /tmp/pretable-pinned-drag-status.before
test ! -e /tmp/pretable-pinned-drag-artifacts.backup
mkdir /tmp/pretable-pinned-drag-artifacts.backup
test ! -e apps/website/.next || mv apps/website/.next /tmp/pretable-pinned-drag-artifacts.backup/.next.before
test ! -e apps/website/test-results || mv apps/website/test-results /tmp/pretable-pinned-drag-artifacts.backup/test-results.before
test ! -e apps/website/playwright-report || mv apps/website/playwright-report /tmp/pretable-pinned-drag-artifacts.backup/playwright-report.before
find /tmp/pretable-pinned-drag-artifacts.backup -mindepth 1 -maxdepth 1 -print
```

Expected: the status baseline is empty, each pre-existing ignored artifact is listed under the exact backup directory, the three workspace artifact paths are now absent, and `lsof` exits 1. If the backup path already exists, stop and inspect it rather than overwriting it. If the port is occupied, choose another explicit high port, repeat the check, and replace `43193` with that literal port in every later command; do not rely on a shell variable surviving across tool calls.

From this point until Task 3 Step 9 completes, any early stop—including a build, test, review, or server-start failure—must first run Task 3 Step 9's guarded server-stop and artifact-restoration block. Do not leave the ignored baseline parked in `/tmp`, and do not delete the backup tree until every `.before` entry has been restored and tracked status matches.

- [ ] **Step 4: Build the website once from the rebased source**

Run:

```bash
pnpm --filter @pretable/app-website build
```

Expected: exit 0. Record known framework or bundle notices separately; stop on a build failure or a new product warning.

- [ ] **Step 5: Start and track the exact production server**

Start this as a tracked long-running process, retaining its session identifier:

```bash
pnpm --filter @pretable/app-website exec next start --hostname localhost --port 43193
```

In another command, run:

```bash
curl --fail --silent --show-error --output /dev/null "http://localhost:43193/"
```

Expected: the server reports ready and the health check exits 0. Do not start an untracked background process.

### Task 2: Harden the existing pinned-drop gesture and prove both retry branches

**Files:**

- Modify: `apps/website/e2e/smoke.spec.ts:890-915`
- Reference: `apps/website/e2e/smoke.spec.ts:970-993`
- Reference: `apps/website/e2e/helpers.ts:175-215`

- [ ] **Step 1: Replace the unverified single grab with the bounded engagement loop**

Keep the existing setup, baseline header assertions, six-pixel trailing-edge destination, and final assertions. Replace the gesture at `apps/website/e2e/smoke.spec.ts:900-909` with this shape:

```ts
const sectorHeader = columnParts(layout, "sector").header;
await waitForStablePosition(sectorHeader);

const ghost = page.locator("[data-pretable-reorder-ghost]");
let grabbed = false;
for (let attempt = 0; attempt < 3 && !grabbed; attempt += 1) {
  const sector = await sectorHeader.boundingBox();
  if (!sector) continue;
  const y = sector.y + sector.height / 2;
  const grabX = sector.x + sector.width / 2;
  await page.mouse.move(grabX, y);
  await page.mouse.down();
  await page.mouse.move(grabX + 12, y, { steps: 3 });
  grabbed = (await ghost.count()) > 0;
  if (!grabbed) await page.mouse.up();
}
expect(grabbed, "reorder drag did not engage on the sector header").toBe(true);

const note = await columnParts(layout, "note").header.boundingBox();
if (!note) await page.mouse.up();
expect(note, "right-pinned note header is not measurable").not.toBeNull();
if (!note) return;
const dropY = note.y + note.height / 2;
await page.mouse.move(note.x + note.width - 6, dropY, { steps: 10 });
await page.mouse.up();
```

Update the nearby comment so it says settling is best-effort, the source box is remeasured for each bounded attempt, the ghost proves engagement, and the destination is measured only after engagement. Do not copy the sideways test's scroll-specific assertions or extract a helper.

- [ ] **Step 2: Run formatting and static syntax checks on the intended implementation**

Run:

```bash
pnpm exec prettier --write apps/website/e2e/smoke.spec.ts
pnpm exec eslint apps/website/e2e/smoke.spec.ts
git show origin/main:apps/website/e2e/smoke.spec.ts | pnpm exec eslint --stdin --stdin-filename apps/website/e2e/smoke.spec.ts
git diff --check
```

Expected: Prettier and `git diff --check` exit 0 and only the approved test block changes. The direct-file lint and the `origin/main` stdin baseline both exit 1 with the identical sole unchanged `qty` unused diagnostic at line 542; no diagnostic is in the changed hunk. The configured repository CI lint excludes `e2e`, so this direct comparison records that the change added no lint diagnostic.

- [ ] **Step 3: Prove first-miss recovery with a temporary positive control**

Temporarily replace the intended assignment:

```ts
grabbed = (await ghost.count()) > 0;
```

with:

```ts
const observedGhost = (await ghost.count()) > 0;
grabbed = attempt === 0 ? false : observedGhost;
```

Run:

```bash
env -u NO_COLOR BASE_URL="http://localhost:43193" pnpm --filter @pretable/app-website smoke smoke.spec.ts --project=chromium --grep 'showcase: dropping into the right-pinned group pins the column' --retries=0 --workers=1
```

Expected: 1/1 passes with zero runner retries. This proves an engaged first attempt is released through the miss path and a freshly measured later attempt can recover.

- [ ] **Step 4: Prove the terminal engagement guard with a temporary negative control**

Temporarily replace the recovery-control assignment with:

```ts
grabbed = false;
```

Run the same focused Chromium command from Step 3.

Expected: exit nonzero with exactly one failed test at `reorder drag did not engage on the sector header`; it must not reach the later final-header timeout. A runner retry must not occur.

- [ ] **Step 5: Restore the intended assignment and confirm a clean focused pass**

Restore exactly:

```ts
grabbed = (await ghost.count()) > 0;
```

Delete the temporary `observedGhost` declaration completely; it must not remain in the intended implementation.

Run:

```bash
pnpm exec prettier --check apps/website/e2e/smoke.spec.ts
git diff --check
env -u NO_COLOR BASE_URL="http://localhost:43193" pnpm --filter @pretable/app-website smoke smoke.spec.ts --project=chromium --grep 'showcase: dropping into the right-pinned group pins the column' --retries=0 --workers=1
```

Expected: formatting and diff checks pass; focused Chromium is 1/1 with zero retries; the temporary controls are absent from the diff.

### Task 3: Run the exact acceptance matrix and commit the test hardening

**Files:**

- Modify: `apps/website/e2e/smoke.spec.ts`
- Verify: `docs/superpowers/specs/2026-08-10-pinned-drag-smoke-hardening-design.md`
- Verify: `docs/superpowers/plans/2026-08-10-pinned-drag-smoke-hardening.md`

- [ ] **Step 1: Run the focused test ten times in Chromium with retries disabled**

Run:

```bash
env -u NO_COLOR BASE_URL="http://localhost:43193" pnpm --filter @pretable/app-website smoke smoke.spec.ts --project=chromium --grep 'showcase: dropping into the right-pinned group pins the column' --repeat-each=10 --retries=0 --workers=1
```

Expected: 10/10 pass in the initial run, zero failures, zero retries.

- [ ] **Step 2: Run the focused test ten times in WebKit with retries disabled**

Run:

```bash
env -u NO_COLOR BASE_URL="http://localhost:43193" pnpm --filter @pretable/app-website smoke smoke.spec.ts --project=webkit --grep 'showcase: dropping into the right-pinned group pins the column' --repeat-each=10 --retries=0 --workers=1
```

Expected: 10/10 pass in the initial run, zero failures, zero retries.

- [ ] **Step 3: Run the complete smoke suite once in each browser with retries disabled**

Run these independently; do not combine them into one matrix command:

```bash
env -u NO_COLOR BASE_URL="http://localhost:43193" pnpm --filter @pretable/app-website smoke --project=chromium --retries=0
env -u NO_COLOR BASE_URL="http://localhost:43193" pnpm --filter @pretable/app-website smoke --project=webkit --retries=0
```

Expected: both complete suites pass on their initial execution, with zero retries. Record exact selected, passed, failed, and retry counts for each browser.

- [ ] **Step 4: Run the final static and scope gates**

Run:

```bash
pnpm --filter @pretable/app-website typecheck
pnpm exec eslint apps/website/e2e/smoke.spec.ts
git show origin/main:apps/website/e2e/smoke.spec.ts | pnpm exec eslint --stdin --stdin-filename apps/website/e2e/smoke.spec.ts
pnpm exec prettier --check apps/website/e2e/smoke.spec.ts docs/superpowers/specs/2026-08-10-pinned-drag-smoke-hardening-design.md docs/superpowers/plans/2026-08-10-pinned-drag-smoke-hardening.md
git diff --check
git diff --stat origin/main...HEAD
git diff --name-only origin/main...HEAD
git diff --stat
git diff --name-only
```

Expected: typecheck, Prettier, and diff checks pass. The direct-file lint and the `origin/main` stdin baseline both exit 1 with the identical sole unchanged `qty` unused diagnostic at line 542; no diagnostic is in the changed hunk. The configured repository CI lint excludes `e2e`, so this direct comparison records that the change added no lint diagnostic. The committed branch diff contains the approved design and implementation plan; the working diff contains only the smoke test. Together they contain no product or public API files and no Changeset.

- [ ] **Step 5: Commit only the test implementation**

Run:

```bash
git add apps/website/e2e/smoke.spec.ts
git diff --cached --check
git diff --cached --stat
git commit -m "test(website): harden pinned column drag"
git status --short
```

Expected: one test-only implementation commit and a clean worktree. The already committed design and plan remain separate documentation commits. Keep the production server running for review-requested browser checks.

- [ ] **Step 6: Request an independent implementation review**

Run:

```bash
git rev-parse origin/main
git rev-parse HEAD
git diff --check origin/main...HEAD
git diff --stat origin/main...HEAD
```

Use `@superpowers:requesting-code-review` with those exact base/head SHAs and the approved design and plan as the review contract. Require the reviewer to inspect the committed branch diff, pointer lifecycle, engagement proof, destination timing, final assertions, file scope, and supplied verification evidence.

Expected: no Critical or Important findings. The reviewer sees all three committed branch files, including the test implementation.

- [ ] **Step 7: Resolve review findings and reverify while the server remains available**

If the reviewer reports a valid finding, implement the smallest in-scope correction, rerun the affected focused controls/matrix and static gates, and commit the correction separately. Then send the updated `origin/main...HEAD` range back to the same reviewer. Repeat until approved, with at most three review iterations before asking the user for direction.

Expected: independent approval, all affected checks rerun after the final code change, and a clean worktree. Do not stop the server until review is approved.

- [ ] **Step 8: Run the final committed scope gate**

Run:

```bash
git diff --check origin/main...HEAD
git diff --stat origin/main...HEAD
git diff --name-only origin/main...HEAD
git status --short --branch
```

Expected: exactly the approved design, implementation plan, and smoke test are present; no Changeset, product file, public API file, or temporary control remains.

- [ ] **Step 9: Stop the exact server and restore the ignored-artifact baseline**

Send Ctrl-C to the tracked server session. Then run:

```bash
set -euo pipefail
if lsof -nP -iTCP:43193 -sTCP:LISTEN; then exit 1; fi
if curl --fail --silent --show-error --output /dev/null "http://localhost:43193/"; then exit 1; fi
test -d /tmp/pretable-pinned-drag-artifacts.backup
test ! -e apps/website/.next || mv apps/website/.next /tmp/pretable-pinned-drag-artifacts.backup/.next.run
test ! -e apps/website/test-results || mv apps/website/test-results /tmp/pretable-pinned-drag-artifacts.backup/test-results.run
test ! -e apps/website/playwright-report || mv apps/website/playwright-report /tmp/pretable-pinned-drag-artifacts.backup/playwright-report.run
test ! -e /tmp/pretable-pinned-drag-artifacts.backup/.next.before || mv /tmp/pretable-pinned-drag-artifacts.backup/.next.before apps/website/.next
test ! -e /tmp/pretable-pinned-drag-artifacts.backup/test-results.before || mv /tmp/pretable-pinned-drag-artifacts.backup/test-results.before apps/website/test-results
test ! -e /tmp/pretable-pinned-drag-artifacts.backup/playwright-report.before || mv /tmp/pretable-pinned-drag-artifacts.backup/playwright-report.before apps/website/playwright-report
test ! -e /tmp/pretable-pinned-drag-artifacts.backup/.next.before
test ! -e /tmp/pretable-pinned-drag-artifacts.backup/test-results.before
test ! -e /tmp/pretable-pinned-drag-artifacts.backup/playwright-report.before
test ! -e /tmp/pretable-pinned-drag-status.after
git status --short > /tmp/pretable-pinned-drag-status.after
cmp /tmp/pretable-pinned-drag-status.before /tmp/pretable-pinned-drag-status.after
find /tmp/pretable-pinned-drag-artifacts.backup -depth -delete
rm /tmp/pretable-pinned-drag-status.before /tmp/pretable-pinned-drag-status.after
git status --short --branch
```

Expected: `lsof` finds no listener, curl exits nonzero, the pre-existing ignored artifact directories are restored exactly from their moved backups, only run-created artifact directories are deleted from the exact temporary backup tree, the before/after tracked status matches, the temporary backup path is gone, and the worktree is clean. `set -euo pipefail` and the explicit listener/HTTP guards stop the block before any later mutation or deletion if a prerequisite is violated; a failed restoration guard or `cmp` likewise prevents `find ... -delete` from running.

### Task 4: Open the follow-up PR and merge only after all checks are green

**Files:**

- Verify only: complete branch diff against `origin/main`
- External state: GitHub branch, pull request, checks, and squash merge

- [ ] **Step 1: Re-fetch and prove the branch still contains current upstream**

Run:

```bash
git fetch --prune origin
git status --short --branch
git merge-base --is-ancestor origin/main HEAD
git rev-list --left-right --count origin/main...HEAD
git diff --check origin/main...HEAD
```

Expected: clean worktree, ancestry exit 0, behind count 0, and clean diff. If upstream advanced, rebase the unpushed branch, then repeat Task 1 Steps 3–5 and Task 3 Steps 1–4 and 6–9 so the build, browser matrix, review, cleanup, and committed diff all cover the new base. Skip Task 3 Step 5 when the rebase leaves the implementation unchanged; if conflict resolution changes the smoke test, rerun Task 2 Steps 3–5 and use Task 3 Step 5 to commit that correction before review.

- [ ] **Step 2: Push the branch and open a focused PR**

Use `@github:yeet` to push `blove/harden-pinned-drag-smoke` and open a ready PR titled `test(website): harden pinned column drag` with:

```md
## Summary

- verify that the pinned-column reorder drag engaged before targeting the drop
- retry only the freshly measured source grab, with bounded pointer cleanup
- remeasure the moving pinned destination after engagement

## Test plan

- deterministic first-miss recovery control: pass without runner retry
- deterministic all-miss control: fails at the engagement guard
- focused pinned-drop test: Chromium 10/10 and WebKit 10/10, retries disabled
- full smoke: Chromium and WebKit initial runs, retries disabled
- website typecheck, focused lint, formatting, and diff checks

## Changeset

Not required: test and internal planning documentation only; no packaged behavior or public documentation changes.
```

Expected: the remote branch and PR contain only the approved scope. Re-read the rendered title/body and full file list before enabling merge.

- [ ] **Step 3: Enable squash auto-merge and monitor every required check**

After confirming the PR diff and review are clean, run this with the branch name (so no shell variable or placeholder is required):

```bash
gh pr merge --auto --squash blove/harden-pinned-drag-smoke
gh pr checks --watch blove/harden-pinned-drag-smoke
```

Monitor CI, preview deployment, and browser smoke to terminal state.

Expected: all required checks pass. If any check fails, use `@github:gh-fix-ci` to inspect the failing job before changing files; do not treat a runner retry or unrelated failure as automatically acceptable.

- [ ] **Step 4: Verify the merge and post-merge main run**

After auto-merge completes, record the PR URL and merge SHA. Confirm the merge is on `origin/main`, the follow-up branch introduces no release Changeset, and the same-commit main CI/production smoke reaches a successful terminal state.

Expected: PR merged by squash on green, no unexpected open PR or release publication, and the repository remains clean.
