# Component Kit Documentation Implementation Plan

> **For agentic workers:** Use superpowers:subagent-driven-development for independent example work and review.

**Goal:** Make the component kit documentation accurate, approachable, and supported by complete examples.

**Architecture:** Documentation changes stay in the website. Two examples distinguish control replacement from custom editing; no public runtime behavior changes.

**Tech Stack:** MDX, React, TypeScript, Next.js, Playwright.

- [x] Repair `content/examples/custom-cell-editor/`: introduce a named custom editor with pending and error UI, retain numeric conversion, register all source files, and verify its save/cancel/error interactions.
- [x] Add `content/examples/components-editors/`: native input/textarea/action replacements at module scope, controlled rows and a delayed quantity rejection, concise scoped CSS, definition and demo modules.
- [x] Rewrite `content/docs/grid/components.mdx` with decision table, minimal replacement, examples, compact API inventory, styling selectors, overlay guidance and migration notes.
- [x] Edit `content/docs/grid/editing.mdx`, `keyboard.mdx`, and `api-reference.mdx`: correct permission behavior, document custom editor responsibility and fields, link customization, simplify lifecycle, and remove repetition.
- [x] Correct the existing Button example's misleading caption and ref-only contract comment.
- [x] Generate the example registry with `pnpm --filter @pretable/app-website examples:gen`; run website typecheck, lint, Vitest and build using the pinned toolchain.
- [x] Add and run focused browser checks for the actual documentation examples, including pending/error, corrected retry, multiline editing, native refs and actions.
- [ ] Review the diff and rendered docs, create a PR, verify its deployment in Chrome, merge after required checks pass, and verify production with Chrome.

Paths above are relative to `apps/website/`. Use `PATH=/tmp/pretable-kit-bin:$PATH pnpm` for local commands. The working branch is `blove/component-kit-docs` in the existing isolated worktree.
