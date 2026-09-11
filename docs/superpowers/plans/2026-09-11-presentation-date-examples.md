# Presentation and date examples implementation plan

> **For agentic workers:** Use superpowers:subagent-driven-development to implement the bounded examples and review their integration.

**Goal:** Make Cell presentations and Date formatting concrete with five live, copyable examples.

**Architecture:** Follow the existing example.ts/demo.tsx/source pattern. Four standalone presentational galleries sit beside their component reference sections; one invoice grid demonstrates the built-in date pipeline. Existing combined grid remains. Shared CSS setup stays in the documentation, never in lazy example modules.

**Tech Stack:** React, TypeScript, MDX, Pretable public exports, Playwright Chromium and WebKit.

## Approved scope

The user accepted the recommendation to start with Cell presentations and Date formatting. Use small previews instead of enlarging the combined grid or adding a separate gallery page. No public runtime/API changes.

- Delta: positive, negative, zero changes with human-readable formatted text.
- Status: positive, negative, warning, info, neutral with visible labels.
- Badge: all four tones and untoned default with visible labels.
- Entity: primary with secondary and primary alone.
- Dates: canonical invoice due dates and null, explicit en-US/en-GB/de-DE locale selector, raw and formatted columns, earliest/latest sort buttons using the actual query API. Empty dates stay last in both directions. Locale changes display, never raw data.

## Tasks

- [x] Add `presentation-delta`, `presentation-status`, `presentation-badge`, `presentation-entity` under `apps/website/content/examples/`, each with example.ts, demo.tsx and one complete source file. Embed beside the four headings in `apps/website/content/docs/grid/cell-presentations.mdx`. Trim superseded snippets, retain API contracts and combined grid.
- [x] Add `date-formatting` with example.ts, demo.tsx, InvoiceDatesGrid.tsx, columns.ts and data.ts. Embed near the opening of `apps/website/content/docs/grid/date-formatting.mdx`; tell the reader what to try.
- [x] Add browser checks in `apps/website/e2e/presentation-date-examples.spec.ts` for the variants, locale display with stable raw values, actual ascending/descending row order, and empty-last behavior. Verify source links resolve and mobile layout stays within the page.
- [x] Regenerate `apps/website/lib/docs/examples/{demos,registry}.generated.ts` using `PATH=/tmp/pretable-kit-bin:$PATH pnpm --filter @pretable/app-website examples:gen`.
- [x] Review requirements and implementation. Run website tests, typecheck, lint, formatting, registry freshness, production build and focused Playwright against localhost. Expected: all pass.
- [ ] Create PR, wait for all checks, merge on green. Verify deployed examples through Chrome MCP and focused browser tests, then wait for production CI. Report exact results.
