# Individual Component Examples

> Use the subagent-driven-development workflow for independent examples and review.

**Goal:** Give each kit component one small, concrete, copyable live example beside its reference.

**Design:** Preserve the existing integration examples. Add standalone Button actions, IconButton pin toggle, Select sort control, TextInput search, Textarea note, and Checkbox select-all/mixed examples. Each example owns local state, uses accessible names and the real exported component, and registers its complete source. Keep preview height appropriate to the small task; no runtime API changes.

**Files:** Six `apps/website/content/examples/kit-*/` folders (example.ts, demo.tsx, named component source), `content/docs/grid/components.mdx`, generated example registries, focused `e2e/kit-examples-*.spec.ts` tests.

- [x] Implement Button and IconButton examples with focused browser checks.
- [x] Implement Select and Checkbox examples with focused browser checks.
- [x] Implement TextInput and Textarea examples with focused browser checks.
- [x] Embed each example beside its component; remove superseded partial code fences.
- [x] Generate registry; validate docs/API links, website tests/types/lint/format/build, browser interactions in Chromium and WebKit, and layout in Chrome.
- [ ] Review, create PR, verify preview, merge on green, and verify production using the user's established authorization.

Use the existing isolated worktree on `blove/component-examples` and pinned `PATH=/tmp/pretable-kit-bin:$PATH pnpm`. The website's Next.js agent instructions apply.
