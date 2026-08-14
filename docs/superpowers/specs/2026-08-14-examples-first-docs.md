# Examples-first docs

**Status:** Approved, in execution
**Scope:** every page under `apps/website/content/docs/`

## The goal

The docs are as much marketing as reference. A reader arriving on any page
should see the thing working before they read a word of explanation.

Three rules, in priority order:

1. **Every page leads with a running example.** The first substantial thing
   after the intro paragraph is an `<Example>`, not prose and not a fence.
2. **Multiple examples where a page teaches multiple things.** One per main
   topic. A page with three distinct teachings gets three examples, each
   immediately before or at the head of the section it belongs to.
3. **The prose is built around the examples.** Sections should refer to what the
   reader just saw — "the grid above", "drag the chip you see in the panel" —
   not describe an abstraction the page never shows. Rewrite prose that predates
   the example and now reads past it.

Today only 3 of 40 pages lead with an example; `editing.mdx`'s sits at line 290.

## The authoring contract

An example is a folder under `apps/website/content/examples/<slug>/`:

```
example.ts     default-exports defineExample({ title, description, files, height? })
demo.tsx       optional; default-exports a props-free component
<sources>      the real files, every one declared in `files`
```

Hard rules, all enforced by `lib/docs/__tests__/examples-registry-guard.test.ts`:

- **Every non-conventional file in the folder must appear in `files`.** No hidden
  helpers. A mock either gets shown or lives in `demo.tsx`.
- **`description` is single-line plain prose** — no newline, no backtick run, no
  leading list or heading marker.
- **Slug is lowercase kebab-case starting with a letter.**
- **Every registered example must be referenced**, and every `<Example id>` must
  resolve. One example may be referenced from more than one page.
- **No `[!focus` text may survive** into displayed source.
- **If a file declares focus markers, the first focused line must fall inside
  the visible window.** Put the interesting part near the top of the file.

Run `pnpm examples:gen` from `apps/website` after adding a folder, and commit the
regenerated `registry.generated.ts` and `demos.generated.ts`.

## Non-negotiable API facts

- `viewportHeight` is **required** on `PretableSurface`.
- `ariaLabel` is **required** on `PretableSurface` and `<Pretable>`. Give it
  something a screen-reader user would recognise, never a placeholder.
- `columns` is generic over the column tuple, so `createColumnHelper` + `as const`
  works. Controlled selection uses `PretableSelectionFor<typeof columns>`.
- **Never add a cast to make something assign.** Every cast in this codebase so
  far has been hiding a real defect. Report instead.
- Demos mount lazily (in view + selected). Pane default height 480px; `height`
  overrides. Keep columns narrow and rows few.

## The verification bar

A passing test proves almost nothing here. Every example must be **seen working
in a real browser against a production build**.

- From `apps/website`: `lsof -ti:3000 | xargs kill -9`, then `pnpm build`, then
  `pnpm start`. Always kill → build → start; `pkill` leaves the port held and a
  stale server serves mismatched chunks against a fresh `.next`, producing
  failures that are pure artifact.
- Drive with Playwright, not a raw browser tool. Demos mount lazily, so
  `scrollIntoViewIfNeeded()` the figure first or you will see an empty pane and
  wrongly conclude it is broken.
- Scratch specs at `apps/website/e2e/zz-scratch-*.spec.ts`, run with
  `BASE_URL=http://localhost:3000 pnpm exec playwright test <file> --workers=1
--project=chromium`, **deleted afterward**.
- Assert the behaviour the example exists to show, not that it rendered. If a
  gesture can't be driven from Playwright, say so plainly rather than claiming
  success from a screenshot.

## Every example is a bug-finding opportunity

Authoring examples in this project has surfaced eight product defects, because
rendering a claim tests it. If the page's prose does not match what the API
actually does, **that is a finding worth reporting, not working around**. Do not
paper over it with a cast, a workaround, or a quietly reworded sentence.

## Pages that stay reference

`theming/token-reference.mdx` is a generated-guarded table and takes no example.
Everything else gets at least one, including the `api-reference` pages — those
get a single "putting it together" example at the top, then keep their tables.
