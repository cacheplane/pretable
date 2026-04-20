# GitHub Actions CI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a GitHub Actions CI workflow with five parallel jobs (test, typecheck, lint, format, build) triggered on PRs to main.

**Architecture:** Single workflow file at `.github/workflows/ci.yml`. Five jobs share identical setup steps (checkout, pnpm, node, install) and each run one command. Concurrency group cancels stale runs.

**Tech Stack:** GitHub Actions, pnpm/action-setup@v4, actions/setup-node@v4, actions/checkout@v4

---

## File Structure

- Create: `.github/workflows/ci.yml` — the complete CI workflow

---

### Task 1: Create CI workflow file

**Files:**
- Create: `.github/workflows/ci.yml`

- [ ] **Step 1: Create the .github/workflows directory**

```bash
mkdir -p .github/workflows
```

- [ ] **Step 2: Write the workflow file**

Create `.github/workflows/ci.yml` with the following content:

```yaml
name: CI

on:
  pull_request:
    branches: [main]

concurrency:
  group: ci-${{ github.ref }}
  cancel-in-progress: true

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: pnpm
      - run: pnpm install --frozen-lockfile
      - run: pnpm test

  typecheck:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: pnpm
      - run: pnpm install --frozen-lockfile
      - run: pnpm typecheck

  lint:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: pnpm
      - run: pnpm install --frozen-lockfile
      - run: pnpm lint

  format:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: pnpm
      - run: pnpm install --frozen-lockfile
      - run: pnpm format

  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: pnpm
      - run: pnpm install --frozen-lockfile
      - run: pnpm build
```

- [ ] **Step 3: Verify the workflow YAML is valid**

Run: `python3 -c "import yaml; yaml.safe_load(open('.github/workflows/ci.yml'))"`

Expected: No output (no parse error). If `yaml` module is not available, use:

Run: `node -e "const fs = require('fs'); const y = fs.readFileSync('.github/workflows/ci.yml', 'utf8'); console.log(y.includes('on:') && y.includes('jobs:') ? 'OK' : 'INVALID')"`

Expected: `OK`

- [ ] **Step 4: Verify all referenced commands work locally**

Run each command to confirm they exist and exit cleanly:

```bash
pnpm test
pnpm typecheck
pnpm lint
pnpm format
pnpm build
```

Expected: All five exit with code 0.

- [ ] **Step 5: Commit**

```bash
git add .github/workflows/ci.yml
git commit -m "ci: add GitHub Actions workflow with parallel quality checks

Five parallel jobs (test, typecheck, lint, format, build) triggered on
PRs to main. Concurrency group cancels stale runs on force-push."
```
