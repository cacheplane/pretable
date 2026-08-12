# Post-release website maintenance implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a branded App Router favicon, correct the released React/headless documentation contracts, and carry the npm README correction through a verified patch release note.

**Architecture:** Keep the runtime untouched. The website owns one conventional `app/favicon.ico` file and one Playwright integration test; documentation changes stay in their existing root, package, and MDX surfaces; a single React patch Changeset makes the packed README correction publishable. Validate the asset through its route and emitted metadata, validate docs against exported source types, and verify both the local tarball and the combined release queue.

**Tech Stack:** Next.js 16 App Router, Playwright, React 19, MDX, Changesets, pnpm, Node.js

---

## Scope and file map

| File                                                     | Responsibility                                                                                             |
| -------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `apps/website/e2e/smoke.spec.ts`                         | Prove the icon route, MIME/body, emitted metadata link, explicit linked request, and error-free cold load. |
| `apps/website/app/favicon.ico`                           | Multi-size cream/black/orange favicon following the active site palette.                                   |
| `README.md`                                              | Name both React peers and the real lower-level `usePretable` hook.                                         |
| `packages/react/README.md`                               | Put both peer requirements in the README shipped to npm.                                                   |
| `apps/website/content/docs/getting-started/index.mdx`    | State the React and React DOM peer prerequisites.                                                          |
| `apps/website/content/docs/headless/getting-started.mdx` | Narrow `PretableVisibleRow` before reading a data row.                                                     |
| `apps/website/content/docs/headless/state-model.mdx`     | Describe the data/group visible-row union.                                                                 |
| `apps/website/content/docs/headless/api-reference.mdx`   | Replace the stale data-only visible-row interface.                                                         |
| `apps/website/content/docs/grid/api-reference.mdx`       | Use `PretableVisibleRow<TRow>[]` in the React snapshot example.                                            |
| `.changeset/gentle-guides-align.md`                      | Schedule the npm README correction as a React patch.                                                       |

Do not modify runtime packages, package peer dependency declarations, Next.js metadata code, the deferred filesystem loaders, or public API reports. The favicon generator described below is a temporary local tool and must not remain in the final diff.

## Preflight

- [ ] **Step 1: Confirm the worktree is clean and on the maintenance branch**

Run:

```bash
git status --short --branch
git branch --show-current
```

Expected: branch `blove/post-release-maintenance`; no uncommitted files.

- [ ] **Step 2: Rebase the design/plan commits onto the latest main**

Run:

```bash
git fetch --prune origin
git rebase origin/main
```

Expected: clean rebase. If any file in this plan conflicts, stop and reconcile it against current source before implementation.

- [ ] **Step 3: Record the browser-artifact baseline**

Run:

```bash
git status --short
```

Expected: empty. Preserve any unexpected pre-existing file rather than deleting it later.

### Task 1: Add the favicon contract and branded asset

**Required skills:** `@superpowers:test-driven-development`, `@playwright`

**Files:**

- Modify: `apps/website/e2e/smoke.spec.ts`
- Create: `apps/website/app/favicon.ico`
- Temporary only: `.tmp-favicon-build/generate.mjs`

- [ ] **Step 1: Add the failing App Router favicon test**

Extend the Playwright import and add this helper/test near the top of `apps/website/e2e/smoke.spec.ts`:

```ts
import { expect, test, type APIResponse } from "@playwright/test";

async function expectIconResponse(response: APIResponse) {
  expect(response.status()).toBe(200);
  expect(response.headers()["content-type"]).toMatch(/^image\//i);
  expect((await response.body()).byteLength).toBeGreaterThan(100);
}

test("publishes the App Router favicon metadata", async ({ page, request }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(`pageerror: ${error.message}`));
  page.on("console", (message) => {
    if (message.type() === "error") {
      errors.push(`console: ${message.text()}`);
    }
  });

  const directResponse = await request.get("/favicon.ico");
  await expectIconResponse(directResponse);

  await page.goto("/docs", { waitUntil: "domcontentloaded" });
  const iconLink = page
    .locator('head link[rel~="icon"][href*="/favicon.ico"]')
    .first();
  await expect(iconLink).toHaveAttribute("href", /^\/favicon\.ico(?:\?.*)?$/);

  const iconHref = await iconLink.getAttribute("href");
  if (!iconHref) throw new Error("Expected a favicon metadata href");
  await expectIconResponse(await request.get(iconHref));
  expect(errors).toEqual([]);
});
```

Keep the existing tests unchanged. Do not weaken the listener to ignore unrelated cold-load errors; `/docs` is already covered as error-free.

- [ ] **Step 2: Start a tracked local development server**

First verify the chosen port is free:

```bash
lsof -nP -iTCP:43191 -sTCP:LISTEN
```

Expected: no listener. Then start, in a tracked terminal session:

```bash
pnpm --filter @pretable/app-website dev --hostname localhost --port 43191
```

Expected: Next.js reports ready at `http://localhost:43191`.

- [ ] **Step 3: Run the focused test and record the required RED**

Run:

```bash
BASE_URL=http://localhost:43191 pnpm --filter @pretable/app-website smoke smoke.spec.ts --project=chromium --grep "publishes the App Router favicon metadata"
```

Expected: FAIL at `expect(response.status()).toBe(200)` because `/favicon.ico` returns `404`. If it fails for another reason, fix the test harness before creating the asset.

- [ ] **Step 4: Create the temporary deterministic favicon generator**

Create `.tmp-favicon-build/generate.mjs` with `apply_patch` using the code below. This is a deterministic extension of the existing brand mark, so use exact vector geometry rather than generative imagery.

```js
import { chromium } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const sizes = [16, 32, 48, 64];
const buildDirectory = resolve(".tmp-favicon-build");
const previewDirectory = resolve(buildDirectory, "previews");
const output = resolve("apps/website/app/favicon.ico");

function svgFor(size) {
  return `
    <svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 64 64">
      <rect width="64" height="64" rx="11" fill="#fefcf9" />
      <path
        fill="#0c0a09"
        fill-rule="evenodd"
        d="M14 13h9v6c3-4 7-6 12-6 10 0 17 7 17 17s-7 17-17 17c-5 0-9-2-12-5v18h-9V13Zm20 8c-7 0-11 4-11 9s4 9 11 9 10-4 10-9-4-9-10-9Z"
      />
      <circle cx="51" cy="52" r="5" fill="#ea580c" />
    </svg>`;
}

function packIco(images) {
  const directory = Buffer.alloc(6 + images.length * 16);
  directory.writeUInt16LE(0, 0);
  directory.writeUInt16LE(1, 2);
  directory.writeUInt16LE(images.length, 4);

  let imageOffset = directory.length;
  images.forEach(({ size, png }, index) => {
    const entry = 6 + index * 16;
    directory.writeUInt8(size === 256 ? 0 : size, entry);
    directory.writeUInt8(size === 256 ? 0 : size, entry + 1);
    directory.writeUInt8(0, entry + 2);
    directory.writeUInt8(0, entry + 3);
    directory.writeUInt16LE(1, entry + 4);
    directory.writeUInt16LE(32, entry + 6);
    directory.writeUInt32LE(png.length, entry + 8);
    directory.writeUInt32LE(imageOffset, entry + 12);
    imageOffset += png.length;
  });

  return Buffer.concat([directory, ...images.map(({ png }) => png)]);
}

await mkdir(previewDirectory, { recursive: true });
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ deviceScaleFactor: 1 });
const page = await context.newPage();
const images = [];

try {
  for (const size of sizes) {
    await page.setViewportSize({ width: size, height: size });
    await page.setContent(
      `<style>html,body{margin:0;width:${size}px;height:${size}px;overflow:hidden}</style>${svgFor(size)}`,
    );
    const png = await page.locator("svg").screenshot({ type: "png" });
    await writeFile(resolve(previewDirectory, `favicon-${size}.png`), png);
    images.push({ size, png });
  }
} finally {
  await browser.close();
}

await writeFile(output, packIco(images));
console.log(`Wrote ${output} with sizes ${sizes.join(", ")}`);
```

- [ ] **Step 5: Generate and structurally inspect the ICO**

Run:

```bash
node .tmp-favicon-build/generate.mjs
file apps/website/app/favicon.ico
node --input-type=module -e 'import { readFileSync } from "node:fs"; const bytes = readFileSync("apps/website/app/favicon.ico"); const count = bytes.readUInt16LE(4); const sizes = Array.from({ length: count }, (_, index) => { const value = bytes.readUInt8(6 + index * 16); return value === 0 ? 256 : value; }); console.log(sizes.join(","));'
```

Expected: `file` identifies a Windows icon resource and the parser prints `16,32,48,64`.

- [ ] **Step 6: Visually inspect the smallest outputs**

Open these files with the local image viewer at original detail:

- `.tmp-favicon-build/previews/favicon-16.png`
- `.tmp-favicon-build/previews/favicon-32.png`

Expected: cream background, legible dark lowercase `p`, distinct orange dot, no clipped edges or muddy overlap. If either size is unclear, adjust only the vector geometry in the temporary generator, rerun it, and inspect again. Do not change the approved colors.

- [ ] **Step 7: Run the focused GREEN in both engines**

Run:

```bash
BASE_URL=http://localhost:43191 pnpm --filter @pretable/app-website smoke smoke.spec.ts --project=chromium --grep "publishes the App Router favicon metadata"
BASE_URL=http://localhost:43191 pnpm --filter @pretable/app-website smoke smoke.spec.ts --project=webkit --grep "publishes the App Router favicon metadata"
```

Expected: 1/1 passes in Chromium and 1/1 passes in WebKit. The linked href may contain Next.js's cache query suffix; the test deliberately accepts it.

- [ ] **Step 8: Stop the exact development server and clean only temporary files**

Send Ctrl-C to the tracked server session, then run:

```bash
lsof -nP -iTCP:43191 -sTCP:LISTEN
test -f .tmp-favicon-build/generate.mjs
rm -rf -- .tmp-favicon-build
git status --short
```

Expected: no listener; the validation confirms the exact temporary target existed before removal; only `apps/website/app/favicon.ico` and `apps/website/e2e/smoke.spec.ts` remain changed. If Next.js created fresh instruction artifacts under `apps/website`, remove only those newly generated files with `apply_patch`; never remove a preflight-baseline file.

- [ ] **Step 9: Commit the favicon slice**

Run:

```bash
git add apps/website/app/favicon.ico apps/website/e2e/smoke.spec.ts
git diff --cached --check
git commit -m "fix(website): add branded favicon"
```

Expected: one commit containing only the asset and its browser regression.

### Task 2: Correct install and visible-row documentation

**Files:**

- Modify: `README.md`
- Modify: `packages/react/README.md`
- Modify: `apps/website/content/docs/getting-started/index.mdx`
- Modify: `apps/website/content/docs/headless/getting-started.mdx`
- Modify: `apps/website/content/docs/headless/state-model.mdx`
- Modify: `apps/website/content/docs/headless/api-reference.mdx`
- Modify: `apps/website/content/docs/grid/api-reference.mdx`

- [ ] **Step 1: Correct the root React guidance**

In `README.md`, replace:

```md
Peer dependency: `react ^19.0.0`.
```

with:

```md
Peer dependencies: `react ^19.0.0` and `react-dom ^19.0.0`.
```

Replace the lower-level hook sentence with:

```md
For lower-level rendering, selection, keyboard navigation, custom cells, and
measured row heights, use `usePretable` from `@pretable/react`.
```

- [ ] **Step 2: Correct the package and website install guides**

After the install command in `packages/react/README.md`, add:

```md
Requires `react ^19.0.0` and `react-dom ^19.0.0` as peer dependencies.
```

In the first step of `apps/website/content/docs/getting-started/index.mdx`, keep the existing Pretable install command and add:

```mdx
Requires `react ^19.0.0` and `react-dom ^19.0.0` as peer dependencies supplied by your application.
```

Do not add either peer to a Pretable package's production dependencies and do not tell an existing React application to reinstall them.

- [ ] **Step 3: Make the headless starter union-safe**

Replace the visible-row description in `apps/website/content/docs/headless/getting-started.mdx` with:

```mdx
`visibleRows` is the flat filtered + sorted row set. Without grouping, every entry is a data row. Grouping inserts group-header entries into the same list. It is not a viewport window; you get every visible entry and decide how to render it.
```

Replace the current map example with:

```tsx
<tbody>
  {snapshot.visibleRows.map((visibleRow) => {
    if (visibleRow.kind !== "data") return null;
    const { id, row } = visibleRow;

    return (
      <tr key={id}>
        {columns.map((column) => (
          <td key={column.id}>{String(row[column.id])}</td>
        ))}
      </tr>
    );
  })}
</tbody>
```

Immediately after it, add:

```mdx
This first example skips group headers. A custom grouped renderer should branch on `visibleRow.kind` and render both `"data"` and `"group"` entries.
```

- [ ] **Step 4: Correct both headless type references**

In both `apps/website/content/docs/headless/state-model.mdx` and `apps/website/content/docs/headless/api-reference.mdx`, replace the data-only `PretableVisibleRow` interface with this source-aligned block:

```ts
type PretableVisibleRow<TRow extends PretableRow = PretableRow> =
  PretableDataRow<TRow> | PretableGroupRow;

interface PretableDataRow<TRow extends PretableRow = PretableRow> {
  kind: "data";
  id: string;
  row: TRow;
  sourceIndex: number;
  depth: number;
}

interface PretableGroupRow {
  kind: "group";
  id: string;
  depth: number;
  columnId: string;
  value: unknown;
  childCount: number;
  aggregates: Record<string, unknown>;
}
```

Update adjacent prose/table text to say:

- `visibleRows` is a flat, non-windowed list after filtering, sorting, and grouping;
- ungrouped snapshots contain only data entries; and
- grouped snapshots add group-header entries, so consumers narrow on `kind` before reading `row`.

Do not broaden this task into the deferred full grouping guide or unrelated snapshot-field cleanup.

- [ ] **Step 5: Correct the React snapshot example**

In `apps/website/content/docs/grid/api-reference.mdx`, replace:

```ts
visibleRows: {
  id: string;
  row: TRow;
  sourceIndex: number;
}
[];
```

with:

```ts
visibleRows: PretableVisibleRow < TRow > [];
```

- [ ] **Step 6: Check for the exact stale contracts**

Run each command separately:

```bash
rg -n "usePretableModel" README.md packages/react/README.md apps/website/content/docs
rg -n 'visibleRows: \{ id: string; row: TRow; sourceIndex: number \}\[\]' apps/website/content/docs
rg -n "interface PretableVisibleRow" apps/website/content/docs/headless
```

Expected: each exits `1` with no matches. Matches in historical design/plan documents are out of scope and are deliberately not searched.

- [ ] **Step 7: Format and build the documentation site**

Run:

```bash
pnpm exec prettier --check README.md packages/react/README.md "apps/website/content/docs/**/*.mdx"
pnpm --filter @pretable/app-website build
```

Expected: formatting and build pass. Existing Turbopack filesystem-tracing warnings may appear; no new warning or MDX failure is acceptable. If formatting fails, run Prettier write only on the seven files in this task, then repeat the check.

- [ ] **Step 8: Commit the documentation slice**

Run:

```bash
git add README.md packages/react/README.md apps/website/content/docs/getting-started/index.mdx apps/website/content/docs/headless/getting-started.mdx apps/website/content/docs/headless/state-model.mdx apps/website/content/docs/headless/api-reference.mdx apps/website/content/docs/grid/api-reference.mdx
git diff --cached --check
git commit -m "docs: correct React and visible-row guidance"
```

Expected: one documentation-only commit.

### Task 3: Add and verify the package release note

**Files:**

- Create: `.changeset/gentle-guides-align.md`

- [ ] **Step 1: Add the React patch Changeset**

Create `.changeset/gentle-guides-align.md`:

```md
---
"@pretable/react": patch
---

Document both required React 19 peer dependencies in the package README.
```

- [ ] **Step 2: Verify branch-specific and combined release intent**

Run:

```bash
pnpm exec changeset status --since=origin/main
pnpm exec changeset status
```

Expected: both exit `0`. The branch delta contains this React documentation patch (expanded through the configured fixed group); full status remains valid alongside main's existing runtime/API queue. Public releases must be limited to `@pretable/core`, `@pretable/react`, `@pretable/stream-adapter`, and `@pretable/ui`; private app dependent bumps are expected.

If main has no other unconsumed Changesets, branch-delta and full status should describe the same new fixed-group patch. If main accumulates another queue before execution, distinguish those base Changesets from this branch's one new file rather than treating their expected release entries as scope creep.

- [ ] **Step 3: Pack React and inspect the actual tarball README**

Run from the repository root as one shell block:

```bash
set -euo pipefail
pnpm --filter @pretable/react build
maintenance_pack_dir=$(mktemp -d ./.tmp-react-pack.XXXXXX)
pnpm --filter @pretable/react pack --pack-destination "$maintenance_pack_dir"
maintenance_tarball=$(find "$maintenance_pack_dir" -maxdepth 1 -name 'pretable-react-*.tgz' -print -quit)
test -n "$maintenance_tarball"
tar -tzf "$maintenance_tarball" | rg '^package/README.md$'
tar -xOf "$maintenance_tarball" package/README.md | rg 'react \^19\.0\.0.*react-dom \^19\.0\.0'
case "$maintenance_pack_dir" in ./.tmp-react-pack.*) rm -rf -- "$maintenance_pack_dir" ;; *) exit 1 ;; esac
```

Expected: the archive contains `package/README.md`, and the packed text names both peers on the same line. The guarded cleanup removes only the newly created pack directory.

- [ ] **Step 4: Commit the release note**

Run:

```bash
git add .changeset/gentle-guides-align.md
git diff --cached --check
git commit -m "chore: add website maintenance changeset"
```

Expected: one Changeset-only commit.

### Task 4: Run the complete local release gate

**Required skill:** `@superpowers:verification-before-completion`

**Files:** none expected

- [ ] **Step 1: Rebase once more if main advanced**

Run:

```bash
git fetch --prune origin
git status --short
git rebase origin/main
```

Expected: clean status before a clean rebase. If the rebase changes any implementation commit, repeat Tasks 1–3's focused checks before continuing.

- [ ] **Step 2: Run repository test and static gates**

Run each command and record its exit code:

```bash
pnpm test
pnpm typecheck
pnpm lint
pnpm build
pnpm api:check
pnpm lint:packaging
pnpm publish:preflight
pnpm format
git diff --check
```

Expected: every command exits `0`. Known baseline warnings may remain: the measured-height React hook warning, Vite native-loader/large-chunk notices, Turbopack filesystem tracing, and API Extractor's TypeScript-version notice. Treat any new warning or any error as a regression.

- [ ] **Step 3: Start the built website on a fresh production port**

Verify the port is free:

```bash
lsof -nP -iTCP:43192 -sTCP:LISTEN
```

Expected: no listener. Start in a tracked terminal session:

```bash
pnpm --filter @pretable/app-website exec next start --hostname localhost --port 43192
```

Expected: production server ready at `http://localhost:43192`.

- [ ] **Step 4: Run the full browser matrix**

Run:

```bash
BASE_URL=http://localhost:43192 pnpm --filter @pretable/app-website smoke --project=chromium
BASE_URL=http://localhost:43192 pnpm --filter @pretable/app-website smoke --project=webkit
```

Expected: every website test passes in both engines, including the new favicon test. A browser crash may be retried once only after confirming the server stayed healthy; report both the initial failure and clean rerun rather than hiding flakiness.

- [ ] **Step 5: Stop the exact production server and audit hygiene**

Send Ctrl-C to the tracked server session, then run:

```bash
lsof -nP -iTCP:43192 -sTCP:LISTEN
git status --short --branch
git diff origin/main...HEAD --check
git diff --stat origin/main...HEAD
```

Expected: no listener, no uncommitted source or generated files, and only the planned spec/plan, favicon/test, docs, and Changeset files in the branch diff. Remove only fresh browser/build artifacts that were absent from the preflight baseline; preserve anything pre-existing.

### Task 5: Independent review, pull request, and merge

**Required skills:** `@superpowers:requesting-code-review`, `@github:yeet`; use `@github:gh-fix-ci` only if a GitHub Actions check fails.

- [ ] **Step 1: Request an independent implementation review**

Give a fresh reviewer only:

- this plan path;
- `docs/superpowers/specs/2026-08-09-post-release-maintenance-design.md`;
- `git diff origin/main...HEAD`; and
- the verification evidence from Task 4.

Ask for Critical/Important/Minor findings covering favicon validity, test non-vacuity, documentation/source alignment, Changeset scope, and repository hygiene. The reviewer must not edit files.

Expected: Approved with no Critical or Important findings. Resolve any substantive finding in a separate commit, rerun the affected focused checks plus Task 4, and re-review.

- [ ] **Step 2: Push and open a ready pull request**

Reconfirm `git status --short` is empty, then use the GitHub publishing workflow to push `blove/post-release-maintenance` and open a ready PR. The PR body must include:

- favicon `404` root cause and the App Router fix;
- documentation contracts corrected;
- explicit patch Changeset rationale;
- RED evidence and Chromium/WebKit totals;
- full local gate results and known pre-existing warnings; and
- the 16px/32px visual-inspection result (attach a rendered preview only if the
  PR workflow supports local image uploads).

Do not include references to any assistant or tool in commits or PR prose.

- [ ] **Step 3: Wait for all required checks and merge only on green**

Monitor the PR until every required check completes. If a check fails, inspect the actual job logs before changing code; implement only a root-cause fix and repeat local verification. Once green and reviewable, squash-merge the maintenance PR and confirm the branch is merged into `main`.

- [ ] **Step 4: Inspect the release handoff without publishing unrelated work**

After merge, inspect the Changesets version PR. Confirm this Changeset either joined the already-pending patch queue or opened the next patch queue, and that its generated changelog includes the React README note.

Do not merge a version/release PR solely as a side effect of this maintenance change if it also publishes pre-existing runtime/API changes; report its exact scope and obtain separate direction unless that release was already explicitly authorized.

- [ ] **Step 5: Perform the post-publish verification when the patch becomes live**

After the corresponding version PR is intentionally merged and the release workflow succeeds:

1. Resolve the newly published `@pretable/react` version from the npm registry.
2. Pack that exact registry version to a fresh temporary directory.
3. Extract `package/README.md` and confirm it names both `react ^19.0.0` and `react-dom ^19.0.0`.
4. Request deployed `/favicon.ico` and assert `200` plus an image MIME type.
5. Load a deployed page, confirm its `link[rel~="icon"]` points to `/favicon.ico` with any cache suffix, and request that emitted URL successfully.
6. Report release workflow, npm version, and deployment evidence; clean every temporary artifact.

This post-publish step is not a prerequisite for merging the source PR. If the release is not yet authorized or available, hand it off explicitly rather than claiming the registry update is complete.
