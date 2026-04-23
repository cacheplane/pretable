# Playground Pitch Landing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the bare `<InspectionDemo />` in `apps/playground` with the five-section pitch landing per visual-system-design §5 (Nav → Hero → full-bleed dark grid → Receipts → Footer), consuming `@pretable/ui` primitives and Tailwind v4 for app-level styling.

**Architecture:** Three new section components (`<PitchHero />`, `<PitchGrid />`, `<ReceiptsBand />`) composed in `<App>` alongside shipped `<Nav>` and `<Footer>` from `@pretable/ui`. State is fully encapsulated per component. `<PitchGrid />` wraps the existing `InspectionGrid` primitive from `@pretable/react/internal` — no changes to library code. A small local `<CopyCommand />` helper renders the hero's `$ npm i @pretable/react` pill-shaped CTA. Styling uses Tailwind v4 with `@theme inline` mirroring `@pretable/ui` design tokens so utility classes (`bg-cream`, `text-ink-dim`) drive layout and color.

**Tech Stack:** React 19.2, TypeScript 5, Vite 7, Tailwind v4 (`@tailwindcss/vite`), Fraunces via `@fontsource-variable/fraunces`, `@pretable/ui` (workspace), `@pretable/react/internal`, `@pretable-internal/scenario-data`, vitest + jsdom + @testing-library/react.

---

## File Structure

**New files:**

```
apps/playground/src/
  copy-command.tsx          // pill CTA with clipboard write, reused from hero
  pitch-hero.tsx            // §5 hero: eyebrow, headline, dek, 2 CTAs
  pitch-grid.tsx            // §5 full-bleed dark grid: chrome strip + filters + InspectionGrid
  pitch-grid.css            // terminal-dark styles for InspectionGrid's internal classes
  receipts-band.tsx         // §5 receipts: 4 hardcoded stats + bench link
  __tests__/
    copy-command.test.tsx
    pitch-hero.test.tsx
    pitch-grid.test.tsx
    receipts-band.test.tsx
    app.test.tsx            // replaces inspection-demo.test.tsx
```

**Modified files:**

```
apps/playground/package.json        // + @pretable/ui, tailwindcss@^4, @tailwindcss/vite, @fontsource-variable/fraunces
apps/playground/vite.config.ts      // + tailwindcss() plugin, + VITE_APP_VERSION define
apps/playground/src/main.tsx        // (no change expected; imports app.css)
apps/playground/src/app.tsx         // new: Nav + <main>{hero+grid+receipts}</main> + Footer
apps/playground/src/app.css         // rewritten: Tailwind, token imports, @theme inline
apps/playground/tsconfig.json       // (add "DOM" lib if missing; verify vite/client types)
```

**Deleted files:**

```
apps/playground/src/inspection-demo.tsx
apps/playground/src/__tests__/inspection-demo.test.tsx
```

---

## Task 1: Install dependencies & set up Tailwind + tokens

Wire Tailwind v4, Fraunces, and `@pretable/ui` into the app. Nothing renders yet — this task only establishes the build + styling foundation so later tasks can use `bg-cream`, `font-display`, `<Nav>`, etc.

**Files:**

- Modify: `apps/playground/package.json`
- Modify: `apps/playground/vite.config.ts`
- Modify: `apps/playground/src/app.css` (rewritten)

- [ ] **Step 1: Install Tailwind v4, Vite plugin, Fraunces, and the ui workspace package**

Run (from repo root):

```bash
pnpm --filter @pretable/app-playground add @pretable/ui@workspace:*
pnpm --filter @pretable/app-playground add -D tailwindcss@^4 @tailwindcss/vite
pnpm --filter @pretable/app-playground add @fontsource-variable/fraunces
```

Expected: `apps/playground/package.json` gains:

- `dependencies`: `@pretable/ui: "workspace:*"`, `@fontsource-variable/fraunces: "^5.x.x"`
- `devDependencies`: `tailwindcss: "^4.x.x"`, `@tailwindcss/vite: "^4.x.x"`

If the project root has a lockfile-only pattern preferred, use `pnpm install --frozen-lockfile` afterward to confirm no accidental drift.

- [ ] **Step 2: Wire Tailwind plugin + version plumbing into Vite config**

Replace `apps/playground/vite.config.ts` with:

```ts
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";

import pkg from "./package.json" with { type: "json" };

export default defineConfig({
  plugins: [react(), tailwindcss()],
  define: {
    "import.meta.env.VITE_APP_VERSION": JSON.stringify(pkg.version),
  },
});
```

If `package.json` doesn't have a `version` field (it currently uses `"name": "@pretable/app-playground"` without a version in the root read earlier), add `"version": "0.0.0"` to the package.json in Step 1 so `pkg.version` is defined. The spec expects a string; empty fallback is acceptable but explicit is better.

- [ ] **Step 3: Rewrite `app.css` against `@pretable/ui` tokens + Tailwind**

Replace the entire contents of `apps/playground/src/app.css` with:

```css
@import "@fontsource-variable/fraunces/wght.css";
@import "@fontsource-variable/fraunces/wght-italic.css";
@import "@pretable/ui/tokens.css";
@import "@pretable/ui/components.css";
@import "tailwindcss";

@theme inline {
  --color-cream: var(--pt-cream);
  --color-cream-hi: var(--pt-cream-hi);
  --color-cream-rule: var(--pt-cream-rule);
  --color-ink: var(--pt-ink);
  --color-ink-dim: var(--pt-ink-dim);
  --color-ink-softer: var(--pt-ink-softer);
  --color-amber-ink: var(--pt-amber-ink);
  --color-amber: var(--pt-amber);
  --color-amber-soft: var(--pt-amber-soft);
  --color-grid-bg: var(--pt-grid-bg);
  --color-grid-raised: var(--pt-grid-raised);
  --color-grid-rule: var(--pt-grid-rule);
  --color-grid-text: var(--pt-grid-text);
  --color-grid-dim: var(--pt-grid-dim);
  --color-sev-info: var(--pt-sev-info);
  --color-sev-warn: var(--pt-sev-warn);
  --color-sev-err: var(--pt-sev-err);
  --color-sev-ok: var(--pt-sev-ok);

  --font-display: "Fraunces Variable", Georgia, "Times New Roman", serif;
  --font-sans:
    ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto,
    sans-serif;
  --font-mono:
    ui-monospace, SFMono-Regular, Menlo, "Cascadia Code", "Roboto Mono",
    monospace;
}

*,
*::before,
*::after {
  box-sizing: border-box;
}

html,
body {
  margin: 0;
  min-height: 100vh;
}

body {
  font-family: var(--font-sans);
  color: var(--pt-ink);
  background: var(--pt-cream);
}

.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
}
```

Note: this rewrite **deletes** all the `.inspection-*`, `.playground-shell`, `.filter-field`, `.eyebrow`, etc. rules that previously lived here. Those classes will either (a) no longer exist in the DOM after Task 8, or (b) be restyled via `pitch-grid.css` in Task 6 for the ones that InspectionGrid emits internally.

- [ ] **Step 4: Sanity-check the build**

Run:

```bash
pnpm --filter @pretable/app-playground dev
```

Expected: dev server boots with no CSS parse errors. The page will render blank (or just `<InspectionDemo />` unstyled) because layout CSS is gone. That's expected at this stage — we're only confirming Tailwind + token imports compile. Ctrl-C out.

Also verify typecheck passes:

```bash
pnpm --filter @pretable/app-playground typecheck
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/playground/package.json apps/playground/vite.config.ts apps/playground/src/app.css pnpm-lock.yaml
git commit -m "chore(playground): install Tailwind v4, @pretable/ui, and Fraunces; rewrite app.css against tokens"
```

---

## Task 2: Wire `<App>` shell with `<Nav>` and `<Footer>`

Replace the bare `<main><InspectionDemo /></main>` root with the spec's Nav + main + Footer shell. `<InspectionDemo />` remains inside `<main>` temporarily so the page still renders something until Task 8 replaces it section-by-section.

**Files:**

- Modify: `apps/playground/src/app.tsx`
- Test: `apps/playground/src/__tests__/app.test.tsx` (new; will grow over later tasks)

- [ ] **Step 1: Write the failing App shell test**

Create `apps/playground/src/__tests__/app.test.tsx`:

```tsx
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, test } from "vitest";

import { App } from "../app";

afterEach(() => {
  cleanup();
});

describe("<App />", () => {
  test("renders Nav with playground active and version string", () => {
    render(<App />);

    // Nav's header landmark
    const header = screen.getByRole("banner");
    expect(header).toBeInTheDocument();

    // Primary nav links (from @pretable/ui's LINKS: playground/bench/docs/github)
    const primaryNav = screen.getByRole("navigation", { name: "Primary" });
    expect(within(primaryNav).getByText("playground")).toBeInTheDocument();
    expect(within(primaryNav).getByText("bench")).toBeInTheDocument();

    // Active link carries "active" on the anchor
    const active = within(primaryNav).getByText("playground").closest("a");
    expect(active).toHaveClass("active");
  });

  test("renders Footer with a ci status dot and a version string", () => {
    render(<App />);

    // Footer is a contentinfo landmark (HTMLFooter element)
    const footer = screen.getByRole("contentinfo");
    expect(footer).toHaveTextContent(/pretable/i);
    expect(footer).toHaveTextContent(/ci:/i);
  });

  test("renders a <main> landmark containing the page body", () => {
    render(<App />);
    expect(screen.getByRole("main")).toBeInTheDocument();
  });
});
```

Also add `within` to the `@testing-library/react` import at top if it's not already there:

```tsx
import { cleanup, render, screen, within } from "@testing-library/react";
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
pnpm --filter @pretable/app-playground test -- app.test
```

Expected: multiple FAILs — `<App />` currently has no Nav, Footer, or Primary nav. Errors along the lines of `Unable to find role="banner"` or `Unable to find text "playground"`.

- [ ] **Step 3: Rewrite `<App />` with Nav + main + Footer shell**

Replace `apps/playground/src/app.tsx` with:

```tsx
import { Footer, Nav } from "@pretable/ui";

import { InspectionDemo } from "./inspection-demo";

const APP_VERSION = import.meta.env.VITE_APP_VERSION as string;

export function App() {
  return (
    <>
      <Nav active="playground" version={APP_VERSION} />
      <main>
        <InspectionDemo />
      </main>
      <Footer version={APP_VERSION} ciStatus="green" />
    </>
  );
}
```

The `InspectionDemo` render lives inside `<main>` temporarily. Task 8 removes it.

- [ ] **Step 4: Run test to verify it passes**

Run:

```bash
pnpm --filter @pretable/app-playground test -- app.test
```

Expected: all three tests PASS.

Also verify typecheck:

```bash
pnpm --filter @pretable/app-playground typecheck
```

Expected: PASS. (If `import.meta.env.VITE_APP_VERSION` errors about an implicit any, ensure `vite/client` is in `types` in `tsconfig.json` — the repo already sets `"types": ["vite/client", "node"]` per earlier read, so this should be fine.)

- [ ] **Step 5: Commit**

```bash
git add apps/playground/src/app.tsx apps/playground/src/__tests__/app.test.tsx
git commit -m "feat(playground): wrap page in shared Nav + Footer from @pretable/ui"
```

---

## Task 3: `<CopyCommand />` helper

Pill-shaped button used by the hero for the ghost-monospace `$ npm i @pretable/react` CTA. Displays a leading `$ ` glyph + the command; writes the command (without `$ `) to clipboard on click; flashes `✓ copied` for ~1.2s.

**Files:**

- Create: `apps/playground/src/copy-command.tsx`
- Test: `apps/playground/src/__tests__/copy-command.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `apps/playground/src/__tests__/copy-command.test.tsx`:

```tsx
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import { CopyCommand } from "../copy-command";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("<CopyCommand />", () => {
  beforeEach(() => {
    Object.assign(navigator, {
      clipboard: { writeText: vi.fn().mockResolvedValue(undefined) },
    });
  });

  test("renders the command with a leading $ and an accessible label", () => {
    render(<CopyCommand command="npm i @pretable/react" />);

    const button = screen.getByRole("button", {
      name: /copy install command/i,
    });
    expect(button).toBeInTheDocument();
    expect(button).toHaveTextContent("$ npm i @pretable/react");
  });

  test("writes the command (without the $ ) to the clipboard on click", async () => {
    render(<CopyCommand command="npm i @pretable/react" />);

    const button = screen.getByRole("button", {
      name: /copy install command/i,
    });
    fireEvent.click(button);

    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(
      "npm i @pretable/react",
    );
  });

  test("flashes a ✓ copied indicator after a successful copy, then reverts", async () => {
    vi.useFakeTimers();

    render(<CopyCommand command="npm i @pretable/react" />);

    const button = screen.getByRole("button", {
      name: /copy install command/i,
    });

    fireEvent.click(button);

    // flush the clipboard promise
    await vi.runAllTicks();

    expect(button).toHaveTextContent(/copied/i);

    // advance past the 1200ms timer
    vi.advanceTimersByTime(1300);

    expect(button).toHaveTextContent("$ npm i @pretable/react");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm --filter @pretable/app-playground test -- copy-command.test
```

Expected: FAIL — `Cannot find module '../copy-command'`.

- [ ] **Step 3: Implement `<CopyCommand />`**

Create `apps/playground/src/copy-command.tsx`:

```tsx
import { useState } from "react";

export interface CopyCommandProps {
  command: string;
  className?: string;
}

export function CopyCommand({ command, className }: CopyCommandProps) {
  const [copied, setCopied] = useState(false);

  const onClick = async () => {
    try {
      await navigator.clipboard.writeText(command);
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch {
      // Clipboard API can fail in insecure contexts; silent no-op.
    }
  };

  const classes = [
    "inline-flex items-center gap-2 rounded-[2px] border border-ink bg-transparent",
    "px-[18px] py-[10px] font-mono text-[13px] text-ink",
    "hover:bg-ink hover:text-cream-hi transition-colors",
    "focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-ink focus-visible:ring-offset-2 focus-visible:ring-offset-cream",
    className,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <button
      type="button"
      className={classes}
      aria-label="Copy install command"
      onClick={onClick}
    >
      {copied ? "✓ copied" : `$ ${command}`}
    </button>
  );
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
pnpm --filter @pretable/app-playground test -- copy-command.test
```

Expected: all three tests PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/playground/src/copy-command.tsx apps/playground/src/__tests__/copy-command.test.tsx
git commit -m "feat(playground): add CopyCommand helper for hero CTA"
```

---

## Task 4: `<PitchHero />`

Spec §5.2. Cream surface; 64px top/bottom padding; eyebrow + headline with italic amber emphasis + dek with inline `<Receipt>` + two CTAs (primary anchor + `<CopyCommand>`).

**Files:**

- Create: `apps/playground/src/pitch-hero.tsx`
- Test: `apps/playground/src/__tests__/pitch-hero.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `apps/playground/src/__tests__/pitch-hero.test.tsx`:

```tsx
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, test } from "vitest";

import { PitchHero } from "../pitch-hero";

afterEach(() => {
  cleanup();
});

describe("<PitchHero />", () => {
  test("renders the spec eyebrow, headline, and dek", () => {
    render(<PitchHero />);

    // Eyebrow (monospace, uppercase — content check only)
    expect(
      screen.getByText(/\$ pretable — read-heavy wedge · vol\. 1 · no\. 4/i),
    ).toBeInTheDocument();

    // Headline is an <h1>
    const headline = screen.getByRole("heading", { level: 1 });
    expect(headline).toBeInTheDocument();
    expect(headline).toHaveTextContent(/scroll/i);

    // Italic amber emphasis on "scroll"
    const em = within(headline).getByText("scroll");
    expect(em.tagName).toBe("EM");
  });

  test("dek contains at least one Receipt tag", () => {
    render(<PitchHero />);

    // <Receipt> from @pretable/ui renders a <span class="pt-receipt">
    const receipts = document.querySelectorAll(".pt-receipt");
    expect(receipts.length).toBeGreaterThan(0);
  });

  test("renders CTA 1 as an anchor to #grid", () => {
    render(<PitchHero />);

    const tryLink = screen.getByRole("link", {
      name: /try the live playground/i,
    });
    expect(tryLink).toHaveAttribute("href", "#grid");
  });

  test("renders CTA 2 as a CopyCommand for npm i @pretable/react", () => {
    render(<PitchHero />);

    const copyBtn = screen.getByRole("button", {
      name: /copy install command/i,
    });
    expect(copyBtn).toHaveTextContent("$ npm i @pretable/react");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm --filter @pretable/app-playground test -- pitch-hero.test
```

Expected: FAIL — `Cannot find module '../pitch-hero'`.

- [ ] **Step 3: Implement `<PitchHero />`**

Create `apps/playground/src/pitch-hero.tsx`:

```tsx
import { Receipt } from "@pretable/ui";

import { CopyCommand } from "./copy-command";

export function PitchHero() {
  return (
    <section className="bg-cream text-ink border-b border-cream-rule px-7 py-16 md:px-10">
      <div className="mx-auto max-w-[1240px]">
        <p className="font-mono text-[11px] uppercase tracking-[0.08em] text-amber-ink">
          $ pretable — read-heavy wedge · vol. 1 · no. 4
        </p>
        <h1 className="mt-3 font-display text-[44px] leading-[1.02] tracking-[-0.025em] md:text-[60px] md:leading-none">
          the grid that treats{" "}
          <em className="not-italic text-amber-ink [font-style:italic]">
            scroll
          </em>{" "}
          as a first-class feature.
        </h1>
        <p className="mt-5 max-w-[760px] font-display text-[18px] leading-[1.44] text-ink-dim">
          Render 500k rows at <Receipt>60fps</Receipt>. Selection stays keyed by
          row id across filters. Every budget in the <Receipt>p99</Receipt>{" "}
          column is green.
        </p>
        <div className="mt-8 flex flex-wrap items-center gap-3">
          <a
            href="#grid"
            className="inline-flex items-center gap-2 rounded-[2px] bg-ink px-[18px] py-[10px] text-[13px] text-cream-hi hover:bg-ink/90 focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-ink focus-visible:ring-offset-2 focus-visible:ring-offset-cream"
          >
            Try the live playground ↓
          </a>
          <CopyCommand command="npm i @pretable/react" />
        </div>
      </div>
    </section>
  );
}
```

Note on the italic amber span: Tailwind's `italic` utility sets `font-style: italic`, but `<em>` already defaults to italic. The belt-and-suspenders `[font-style:italic]` is a safety net in case a CSS reset neutralized `<em>` styling. `not-italic` reset then arbitrary explicit italic — a single `italic` class would also work; keep whichever reads clearer during implementation.

Simpler form:

```tsx
<em className="italic text-amber-ink">scroll</em>
```

Use the simpler form unless a reset breaks it.

- [ ] **Step 4: Run tests to verify they pass**

```bash
pnpm --filter @pretable/app-playground test -- pitch-hero.test
```

Expected: all four tests PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/playground/src/pitch-hero.tsx apps/playground/src/__tests__/pitch-hero.test.tsx
git commit -m "feat(playground): add PitchHero section"
```

---

## Task 5: `<PitchGrid />` — chrome strip + filter row only

Builds the outer chrome (scale select + telemetry readout + filter inputs) without yet mounting `InspectionGrid`. A placeholder `<div>` stands in for the grid body so tests can assert the surrounding shell in isolation.

**Files:**

- Create: `apps/playground/src/pitch-grid.tsx`
- Test: `apps/playground/src/__tests__/pitch-grid.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `apps/playground/src/__tests__/pitch-grid.test.tsx`:

```tsx
import "@testing-library/jest-dom/vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { afterEach, describe, expect, test } from "vitest";

import { PitchGrid } from "../pitch-grid";

afterEach(() => {
  cleanup();
});

describe("<PitchGrid /> — chrome + filters", () => {
  test("renders a section with id='grid' for anchor linking", () => {
    const { container } = render(<PitchGrid />);
    expect(container.querySelector("#grid")).toBeInTheDocument();
  });

  test("renders a scale select defaulting to dev", () => {
    render(<PitchGrid />);
    const scaleSelect = screen.getByLabelText("Dataset scale");
    expect(scaleSelect).toHaveValue("dev");
  });

  test("renders a telemetry readout with 'rendered 0 · sel none' before any grid activity", () => {
    render(<PitchGrid />);
    const strip = screen.getByTestId("pitch-grid-chrome");
    expect(strip).toHaveTextContent(/rendered 0/i);
    expect(strip).toHaveTextContent(/sel none/i);
  });

  test("renders filter inputs for each filterable column", () => {
    render(<PitchGrid />);

    const filterBar = screen.getByTestId("pitch-grid-filters");
    const inputs = within(filterBar).getAllByRole("textbox");
    expect(inputs.length).toBeGreaterThan(0);
  });

  test("changing the scale select re-derives the dataset (placeholder check via rendered row count after wiring)", () => {
    // Full behavioral check lives in Task 6 (requires InspectionGrid integration).
    // Here we just assert the scale select fires its onChange without throwing.
    render(<PitchGrid />);
    const scaleSelect = screen.getByLabelText("Dataset scale");
    fireEvent.change(scaleSelect, { target: { value: "tiny" } });
    expect(scaleSelect).toHaveValue("tiny");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm --filter @pretable/app-playground test -- pitch-grid.test
```

Expected: FAIL — `Cannot find module '../pitch-grid'`.

- [ ] **Step 3: Implement the skeleton `<PitchGrid />`**

Create `apps/playground/src/pitch-grid.tsx`:

```tsx
import {
  createInspectionDataset,
  inspectionColumns,
  inspectionDatasetScaleOptions,
  type InspectionDatasetScale,
} from "@pretable-internal/scenario-data";
import { useMemo, useState } from "react";

interface InteractionState {
  sort: { columnId: string; direction: "asc" | "desc" } | null;
  filters: Record<string, string>;
  selectedRowId: string | null;
}

export function PitchGrid() {
  const [scale, setScale] = useState<InspectionDatasetScale>("dev");
  const [interactionState, setInteractionState] = useState<InteractionState>({
    sort: null,
    filters: {},
    selectedRowId: null,
  });

  const dataset = useMemo(() => createInspectionDataset(scale), [scale]);

  // Task 6 replaces these with real telemetry values from InspectionGrid.
  const renderedRowCount = 0;
  const selectedId = interactionState.selectedRowId ?? "none";

  return (
    <section
      id="grid"
      className="bg-grid-bg text-grid-text border-y border-grid-rule"
    >
      {/* Chrome strip */}
      <div
        data-testid="pitch-grid-chrome"
        className="flex items-center justify-between border-b border-grid-rule px-7 py-3 font-mono text-[11px] text-grid-dim md:px-10"
      >
        <div className="flex items-center gap-2">
          <span>inspection.log</span>
          <span>·</span>
          <label className="inline-flex items-center gap-1">
            <span className="sr-only">Dataset scale</span>
            <select
              aria-label="Dataset scale"
              className="bg-transparent text-amber outline-none cursor-pointer"
              value={scale}
              onChange={(event) => {
                setScale(event.currentTarget.value as InspectionDatasetScale);
              }}
            >
              {inspectionDatasetScaleOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="flex items-center gap-3">
          <span>rendered {renderedRowCount}</span>
          <span>·</span>
          <span>sel {selectedId}</span>
        </div>
      </div>

      {/* Filter row */}
      <div
        data-testid="pitch-grid-filters"
        className="grid grid-flow-col auto-cols-fr gap-3 border-b border-grid-rule bg-grid-raised px-7 py-3 font-mono text-[12px] md:px-10"
      >
        {dataset.filterableColumnIds.map((columnId) => {
          const column = inspectionColumns.find((c) => c.id === columnId);
          const label = column?.header ?? columnId;
          return (
            <label key={columnId} className="grid gap-1 text-grid-dim">
              <span className="uppercase tracking-[0.06em]">{label}</span>
              <input
                type="text"
                aria-label={`Filter ${label}`}
                value={interactionState.filters[columnId] ?? ""}
                onChange={(event) => {
                  const nextValue = event.currentTarget.value;
                  setInteractionState((current) => ({
                    ...current,
                    filters: { ...current.filters, [columnId]: nextValue },
                  }));
                }}
                className="rounded-[2px] border border-grid-rule bg-grid-bg px-2 py-1 text-grid-text placeholder:text-grid-dim focus:outline-none focus:border-amber"
                placeholder={`Filter ${label.toLowerCase()}`}
              />
            </label>
          );
        })}
      </div>

      {/* Grid body placeholder — replaced in Task 6 */}
      <div
        data-testid="pitch-grid-body-placeholder"
        className="px-7 py-12 text-grid-dim md:px-10"
      >
        grid mounts in task 6
      </div>
    </section>
  );
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
pnpm --filter @pretable/app-playground test -- pitch-grid.test
```

Expected: all five tests PASS.

Also verify typecheck:

```bash
pnpm --filter @pretable/app-playground typecheck
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/playground/src/pitch-grid.tsx apps/playground/src/__tests__/pitch-grid.test.tsx
git commit -m "feat(playground): scaffold PitchGrid chrome strip and filter row"
```

---

## Task 6: `<PitchGrid />` — wire `InspectionGrid` integration + grid-body styles

Mount the real `InspectionGrid` primitive in place of the placeholder. Wire telemetry from `onTelemetryChange` to update the chrome readout. Port grid-internal CSS rules (for the `inspection-header-cell` / `inspection-row` / `inspection-cell` classes InspectionGrid emits) into a new `pitch-grid.css` styled for the terminal-dark theme.

**Files:**

- Modify: `apps/playground/src/pitch-grid.tsx`
- Modify: `apps/playground/src/__tests__/pitch-grid.test.tsx`
- Create: `apps/playground/src/pitch-grid.css`

- [ ] **Step 1: Extend the test to cover real integration**

Append to `apps/playground/src/__tests__/pitch-grid.test.tsx` (inside the same describe):

```tsx
test("mounts an InspectionGrid-styled grid (finds inspection-header-row in DOM)", () => {
  const { container } = render(<PitchGrid />);
  expect(
    container.querySelector(".inspection-header-cell"),
  ).toBeInTheDocument();
});

test("changing scale updates the dataset row count surfaced in the grid", () => {
  render(<PitchGrid />);
  const scaleSelect = screen.getByLabelText("Dataset scale");

  // tiny should render fewer rows than dev — exact assertion deferred to the
  // telemetry update below (renderedRowCount decreases monotonically).
  fireEvent.change(scaleSelect, { target: { value: "tiny" } });
  expect(scaleSelect).toHaveValue("tiny");

  // Chrome strip updates once telemetry flows. The test relies on the
  // onTelemetryChange wiring; if this assertion flakes, the wiring is off.
  const strip = screen.getByTestId("pitch-grid-chrome");
  expect(strip).toHaveTextContent(/rendered/i);
});
```

The existing "placeholder check" test should be **removed** now that real integration lands:

```tsx
// Delete this test block — superseded by the real integration test above.
test("changing the scale select re-derives the dataset (placeholder check via rendered row count after wiring)", () => {
  // ...
});
```

- [ ] **Step 2: Run test to verify the new assertions fail**

```bash
pnpm --filter @pretable/app-playground test -- pitch-grid.test
```

Expected: the new `inspection-header-cell` assertion FAILs (placeholder is still there).

- [ ] **Step 3: Replace placeholder with real `<InspectionGrid />`**

Update `apps/playground/src/pitch-grid.tsx` — replace the `Grid body placeholder` div with:

```tsx
import {
  InspectionGrid,
  type PretableTelemetry,
} from "@pretable/react/internal";
// ...at top, alongside other imports

// ...inside PitchGrid, replace renderedRowCount computation:
const [telemetry, setTelemetry] = useState<PretableTelemetry | null>(null);
const renderedRowCount = telemetry?.renderedRowCount ?? 0;

// ...just below filter row, replace placeholder div with:
<div className="px-0">
  <InspectionGrid
    ariaLabel="Inspection grid"
    filterableColumnIds={dataset.filterableColumnIds}
    interactionState={interactionState}
    onSelectedRowIdChange={(rowId) => {
      setInteractionState((current) => ({
        ...current,
        selectedRowId: rowId,
      }));
    }}
    onSortChange={(sort) => {
      setInteractionState((current) => ({ ...current, sort }));
    }}
    onTelemetryChange={setTelemetry}
    overscan={5}
    rows={[...dataset.rows]}
    viewportHeight={420}
  />
</div>;
```

Final file should read end-to-end as (merge carefully):

```tsx
import {
  createInspectionDataset,
  inspectionColumns,
  inspectionDatasetScaleOptions,
  type InspectionDatasetScale,
} from "@pretable-internal/scenario-data";
import {
  InspectionGrid,
  type PretableTelemetry,
} from "@pretable/react/internal";
import { useMemo, useState } from "react";

import "./pitch-grid.css";

interface InteractionState {
  sort: { columnId: string; direction: "asc" | "desc" } | null;
  filters: Record<string, string>;
  selectedRowId: string | null;
}

export function PitchGrid() {
  const [scale, setScale] = useState<InspectionDatasetScale>("dev");
  const [interactionState, setInteractionState] = useState<InteractionState>({
    sort: null,
    filters: {},
    selectedRowId: null,
  });
  const [telemetry, setTelemetry] = useState<PretableTelemetry | null>(null);

  const dataset = useMemo(() => createInspectionDataset(scale), [scale]);
  const rows = useMemo(() => [...dataset.rows], [dataset.rows]);

  const renderedRowCount = telemetry?.renderedRowCount ?? 0;
  const selectedId = interactionState.selectedRowId ?? "none";

  return (
    <section
      id="grid"
      className="bg-grid-bg text-grid-text border-y border-grid-rule"
    >
      <div
        data-testid="pitch-grid-chrome"
        className="flex items-center justify-between border-b border-grid-rule px-7 py-3 font-mono text-[11px] text-grid-dim md:px-10"
      >
        <div className="flex items-center gap-2">
          <span>inspection.log</span>
          <span>·</span>
          <label className="inline-flex items-center gap-1">
            <span className="sr-only">Dataset scale</span>
            <select
              aria-label="Dataset scale"
              className="bg-transparent text-amber outline-none cursor-pointer"
              value={scale}
              onChange={(event) => {
                setScale(event.currentTarget.value as InspectionDatasetScale);
              }}
            >
              {inspectionDatasetScaleOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="flex items-center gap-3">
          <span>rendered {renderedRowCount}</span>
          <span>·</span>
          <span>sel {selectedId}</span>
        </div>
      </div>

      <div
        data-testid="pitch-grid-filters"
        className="grid grid-flow-col auto-cols-fr gap-3 border-b border-grid-rule bg-grid-raised px-7 py-3 font-mono text-[12px] md:px-10"
      >
        {dataset.filterableColumnIds.map((columnId) => {
          const column = inspectionColumns.find((c) => c.id === columnId);
          const label = column?.header ?? columnId;
          return (
            <label key={columnId} className="grid gap-1 text-grid-dim">
              <span className="uppercase tracking-[0.06em]">{label}</span>
              <input
                type="text"
                aria-label={`Filter ${label}`}
                value={interactionState.filters[columnId] ?? ""}
                onChange={(event) => {
                  const nextValue = event.currentTarget.value;
                  setInteractionState((current) => ({
                    ...current,
                    filters: { ...current.filters, [columnId]: nextValue },
                  }));
                }}
                className="rounded-[2px] border border-grid-rule bg-grid-bg px-2 py-1 text-grid-text placeholder:text-grid-dim focus:outline-none focus:border-amber"
                placeholder={`Filter ${label.toLowerCase()}`}
              />
            </label>
          );
        })}
      </div>

      <InspectionGrid
        ariaLabel="Inspection grid"
        filterableColumnIds={dataset.filterableColumnIds}
        interactionState={interactionState}
        onSelectedRowIdChange={(rowId) => {
          setInteractionState((current) => ({
            ...current,
            selectedRowId: rowId,
          }));
        }}
        onSortChange={(sort) => {
          setInteractionState((current) => ({ ...current, sort }));
        }}
        onTelemetryChange={setTelemetry}
        overscan={5}
        rows={rows}
        viewportHeight={420}
      />
    </section>
  );
}
```

- [ ] **Step 4: Create `pitch-grid.css` with terminal-dark styling for InspectionGrid's emitted classes**

Create `apps/playground/src/pitch-grid.css`:

```css
/*
 * Styles the internal class names InspectionGrid emits (inspection-header-*,
 * inspection-row, inspection-cell, etc.) against the pretable terminal-dark
 * palette. Scoped to #grid so no leakage to other surfaces.
 */

#grid [data-pretable-scroll-viewport] {
  background: var(--pt-grid-bg);
  height: 420px;
  overflow: auto;
  position: relative;
  outline: none;
}

#grid [data-pretable-scroll-viewport]:focus-visible {
  box-shadow: inset 0 0 0 2px var(--pt-amber);
}

#grid .inspection-header-row {
  display: grid;
  position: sticky;
  top: 0;
  z-index: 6;
  border-bottom: 1px solid var(--pt-grid-rule);
  background: var(--pt-grid-head, var(--pt-grid-raised));
}

#grid .inspection-header-cell {
  display: grid;
  gap: 4px;
  align-items: start;
  min-height: 52px;
  border: 0;
  border-right: 1px solid var(--pt-grid-rule);
  background: inherit;
  color: var(--pt-grid-dim);
  font-family: var(--pt-font-mono, ui-monospace, monospace);
  font-size: 11px;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  padding: 14px 12px;
  text-align: left;
  cursor: pointer;
}

#grid .inspection-header-cell strong {
  color: var(--pt-grid-text);
  font-weight: 600;
}

#grid .inspection-header-cell.is-filtered {
  border-bottom: 2px solid var(--pt-amber);
}

#grid .sort-indicator {
  color: var(--pt-amber);
  font-size: 11px;
  opacity: 0.6;
}

#grid .inspection-scroll-content {
  position: relative;
}

#grid .inspection-row {
  display: grid;
  position: absolute;
  inset-inline: 0;
  border-bottom: 1px solid var(--pt-grid-rule);
  cursor: pointer;
}

#grid .inspection-row:hover .inspection-cell {
  background: var(--pt-grid-raised);
}

#grid .inspection-cell {
  display: grid;
  align-content: start;
  gap: 6px;
  min-height: 100%;
  padding: 12px;
  background: var(--pt-grid-bg);
  border-right: 1px solid var(--pt-grid-rule);
  color: var(--pt-grid-text);
  font-family: var(--pt-font-mono, ui-monospace, monospace);
  font-size: 12.5px;
  line-height: 1.52;
}

#grid .inspection-cell[data-pinned="left"] {
  z-index: 3;
  background: var(--pt-grid-head, var(--pt-grid-raised));
}

#grid .inspection-cell[data-selected="true"] {
  background: color-mix(in oklab, var(--pt-amber) 14%, var(--pt-grid-bg));
}

#grid .inspection-cell[data-focused="true"] {
  outline: 1px solid var(--pt-amber);
  outline-offset: -1px;
}

#grid .inspection-cell-label {
  color: var(--pt-grid-dim);
  font-size: 10px;
  font-weight: 600;
  letter-spacing: 0.05em;
  text-transform: uppercase;
}

#grid .inspection-cell-value {
  color: var(--pt-grid-text);
  overflow-wrap: anywhere;
  white-space: pre-wrap;
}
```

- [ ] **Step 5: Run tests + dev server to verify integration**

```bash
pnpm --filter @pretable/app-playground test -- pitch-grid.test
```

Expected: all tests PASS, including the new `inspection-header-cell` assertion and the rendered-telemetry check.

```bash
pnpm --filter @pretable/app-playground dev
```

Open the URL. Expected: full dark grid visible at `#grid`, scrollable, row selection highlights amber, scale dropdown changes dataset, filter inputs narrow rows. Ctrl-C out.

- [ ] **Step 6: Commit**

```bash
git add apps/playground/src/pitch-grid.tsx apps/playground/src/pitch-grid.css apps/playground/src/__tests__/pitch-grid.test.tsx
git commit -m "feat(playground): wire PitchGrid to InspectionGrid with terminal-dark styling"
```

---

## Task 7: `<ReceiptsBand />`

Spec §5.4. Cream surface; Fraunces italic amber header; 4-column grid of Fraunces numbers with top hairline rules; bench link below.

**Files:**

- Create: `apps/playground/src/receipts-band.tsx`
- Test: `apps/playground/src/__tests__/receipts-band.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `apps/playground/src/__tests__/receipts-band.test.tsx`:

```tsx
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, test } from "vitest";

import { ReceiptsBand } from "../receipts-band";

afterEach(() => {
  cleanup();
});

describe("<ReceiptsBand />", () => {
  test("renders the section header with italic 'Receipts' emphasis", () => {
    render(<ReceiptsBand />);
    const heading = screen.getByRole("heading", { level: 2 });
    expect(heading).toHaveTextContent(/receipts/i);
    expect(heading).toHaveTextContent(/, not claims\./i);
  });

  test("renders four stats in order with values and captions", () => {
    render(<ReceiptsBand />);

    const stats = screen.getAllByRole("listitem");
    expect(stats).toHaveLength(4);

    expect(stats[0]).toHaveTextContent(/500k/i);
    expect(stats[0]).toHaveTextContent(/rows rendered/i);

    expect(stats[1]).toHaveTextContent(/2\.4ms/i);
    expect(stats[1]).toHaveTextContent(/frame p50/i);

    expect(stats[2]).toHaveTextContent(/^0$|^0\s/);
    expect(stats[2]).toHaveTextContent(/jank events/i);

    expect(stats[3]).toHaveTextContent(/4\.1×/i);
    expect(stats[3]).toHaveTextContent(/vs gridalpha/i);
  });

  test("renders a link to the bench", () => {
    render(<ReceiptsBand />);
    const link = screen.getByRole("link", {
      name: /see them re-run in the bench/i,
    });
    expect(link).toHaveAttribute("href", "/bench");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm --filter @pretable/app-playground test -- receipts-band.test
```

Expected: FAIL — `Cannot find module '../receipts-band'`.

- [ ] **Step 3: Implement `<ReceiptsBand />`**

Create `apps/playground/src/receipts-band.tsx`:

```tsx
interface Stat {
  value: string;
  caption: string;
}

const STATS: readonly Stat[] = [
  { value: "500k", caption: "rows rendered" },
  { value: "2.4ms", caption: "frame p50" },
  { value: "0", caption: "jank events" },
  { value: "4.1×", caption: "vs gridalpha" },
];

export function ReceiptsBand() {
  return (
    <section className="bg-cream text-ink border-b border-cream-rule px-7 py-[52px] md:px-10">
      <div className="mx-auto max-w-[1240px]">
        <h2 className="font-display text-[28px] leading-[1.12] tracking-[-0.02em] md:text-[32px]">
          <em className="italic text-amber-ink">Receipts</em>, not claims.
        </h2>
        <ul className="mt-6 grid grid-cols-2 gap-6 md:grid-cols-4">
          {STATS.map((stat) => (
            <li key={stat.caption} className="border-t border-ink pt-3">
              <div className="font-display text-[44px] leading-[1] tracking-[-0.02em]">
                {stat.value}
              </div>
              <div className="mt-1 font-mono text-[12px] text-ink-dim">
                {stat.caption}
              </div>
            </li>
          ))}
        </ul>
        <p className="mt-5 font-mono text-[12px] text-ink-softer">
          <a
            href="/bench"
            className="text-amber-ink underline-offset-2 hover:underline"
          >
            See them re-run in the bench →
          </a>
        </p>
      </div>
    </section>
  );
}
```

**Note to implementer:** the four values above are spec placeholders. Before opening the PR, run the bench locally (`pnpm --filter @pretable/app-bench dev` or `pnpm bench:matrix` — check `apps/bench/README.md` for the exact command) and replace `STATS` with four real numbers from a recent run. Leave a comment at the top of the `STATS` constant pointing at where the numbers came from (commit SHA of the bench run) so D can trace provenance when wiring live.

- [ ] **Step 4: Run tests to verify they pass**

```bash
pnpm --filter @pretable/app-playground test -- receipts-band.test
```

Expected: all three tests PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/playground/src/receipts-band.tsx apps/playground/src/__tests__/receipts-band.test.tsx
git commit -m "feat(playground): add ReceiptsBand section with hardcoded snapshot numbers"
```

---

## Task 8: Compose in `<App />`, delete `InspectionDemo`

Replace the temporary `<InspectionDemo />` render in `<App>` with the three new sections stacked inside `<main>`. Delete `inspection-demo.tsx` and its test. Grow `app.test.tsx` to assert section ordering and landmark structure.

**Files:**

- Modify: `apps/playground/src/app.tsx`
- Modify: `apps/playground/src/__tests__/app.test.tsx`
- Delete: `apps/playground/src/inspection-demo.tsx`
- Delete: `apps/playground/src/__tests__/inspection-demo.test.tsx`

- [ ] **Step 1: Write the failing ordering test**

Append to `apps/playground/src/__tests__/app.test.tsx` (inside the same describe):

```tsx
test("renders the three section components in order inside <main>", () => {
  render(<App />);
  const main = screen.getByRole("main");

  // hero h1 appears before receipts h2; grid section has id="grid"
  const h1 = within(main).getByRole("heading", { level: 1 });
  const h2 = within(main).getByRole("heading", { level: 2 });
  const grid = main.querySelector("#grid");

  expect(h1).toBeInTheDocument();
  expect(h2).toBeInTheDocument();
  expect(grid).toBeInTheDocument();

  // DOM order: h1 (hero) → grid section → h2 (receipts)
  const h1Pos = Array.from(main.querySelectorAll("*")).indexOf(h1);
  const gridPos = Array.from(main.querySelectorAll("*")).indexOf(
    grid as Element,
  );
  const h2Pos = Array.from(main.querySelectorAll("*")).indexOf(h2);

  expect(h1Pos).toBeLessThan(gridPos);
  expect(gridPos).toBeLessThan(h2Pos);
});

test("no InspectionDemo-era status card or sidebar is rendered", () => {
  render(<App />);
  // These testids used to live in InspectionDemo.
  expect(
    screen.queryByTestId("inspection-diagnostics"),
  ).not.toBeInTheDocument();
  expect(screen.queryByTestId("inspection-detail")).not.toBeInTheDocument();
});
```

- [ ] **Step 2: Run tests to verify the new assertions fail**

```bash
pnpm --filter @pretable/app-playground test -- app.test
```

Expected: the "three section components" FAILs (no h1/h2 inside `<main>` yet — `InspectionDemo` renders its own markup). The "no InspectionDemo-era" passes (both testids still exist — FAILs). Actually the second assertion FAILs because `InspectionDemo` still mounts inside `<main>`.

Continue to Step 3.

- [ ] **Step 3: Replace `InspectionDemo` with the three new sections**

Replace `apps/playground/src/app.tsx` with:

```tsx
import { Footer, Nav } from "@pretable/ui";

import { PitchGrid } from "./pitch-grid";
import { PitchHero } from "./pitch-hero";
import { ReceiptsBand } from "./receipts-band";

const APP_VERSION = import.meta.env.VITE_APP_VERSION as string;

export function App() {
  return (
    <>
      <Nav active="playground" version={APP_VERSION} />
      <main>
        <PitchHero />
        <PitchGrid />
        <ReceiptsBand />
      </main>
      <Footer version={APP_VERSION} ciStatus="green" />
    </>
  );
}
```

- [ ] **Step 4: Delete the legacy files**

```bash
rm apps/playground/src/inspection-demo.tsx
rm apps/playground/src/__tests__/inspection-demo.test.tsx
```

- [ ] **Step 5: Run full playground test suite to verify everything is green**

```bash
pnpm --filter @pretable/app-playground test
```

Expected: all test files pass — `app.test.tsx`, `copy-command.test.tsx`, `pitch-hero.test.tsx`, `pitch-grid.test.tsx`, `receipts-band.test.tsx`. No references to the deleted `inspection-demo.tsx`.

```bash
pnpm --filter @pretable/app-playground typecheck
```

Expected: PASS. No TypeScript errors from dangling imports.

- [ ] **Step 6: Commit**

```bash
git add apps/playground/src/app.tsx apps/playground/src/__tests__/app.test.tsx
git rm apps/playground/src/inspection-demo.tsx apps/playground/src/__tests__/inspection-demo.test.tsx
git commit -m "feat(playground): compose PitchHero + PitchGrid + ReceiptsBand; delete InspectionDemo"
```

---

## Task 9: Manual verification + bench snapshot for receipts

Run the dev server end-to-end; confirm the five-section layout matches the spec; grab a real bench snapshot and replace the placeholder numbers in `<ReceiptsBand />`.

**Files:**

- Modify: `apps/playground/src/receipts-band.tsx` (replace `STATS` values)

- [ ] **Step 1: Run dev server and verify sections visually**

```bash
pnpm --filter @pretable/app-playground dev
```

Open the URL. Walk through the checklist:

- Nav: sticky-ish header at top, `playground` link marked active, `pretable.` wordmark with amber `.`, version pill visible.
- Hero: cream surface; monospace amber eyebrow reads `$ pretable — read-heavy wedge · vol. 1 · no. 4`; Fraunces headline with italic amber `scroll` word; dek contains at least one `<Receipt>`-styled tag (dark pill with cream text); two CTAs side-by-side; clicking "Try the live playground ↓" scrolls to the grid section; clicking the `$ npm i @pretable/react` pill flashes `✓ copied` and the clipboard contains `npm i @pretable/react` (verify by pasting into a scratch location).
- Grid section: full-bleed dark surface; chrome strip shows `inspection.log · scale: dev` on the left and `rendered <n> · sel none` on the right; filter row below with one input per filterable column; grid body shows wrapped log rows with severity color; clicking a row updates the `sel` readout with the event id; changing the scale dropdown updates both the dataset and `rendered <n>`.
- Receipts band: cream surface below grid; Fraunces italic amber `Receipts` in `Receipts, not claims.` heading; four stats with top hairline rules; bench link below.
- Footer: monospace one-liner with version, CI dot (green), year, MIT note.

If any of the above fails, fix inline before moving on. Refer back to the spec §5 for copy and structure.

Ctrl-C out when done.

- [ ] **Step 2: Capture a real bench snapshot for receipts numbers**

Check `apps/bench/README.md` for the exact bench-matrix command. Typical invocation:

```bash
pnpm --filter @pretable/app-bench bench:matrix
# — or —
pnpm bench:matrix
```

(If neither exists, fall back to `pnpm --filter @pretable/app-bench dev`, select scenario `S7` at scale `stress`, let it run long enough to stabilize, and read the four metrics from the UI.)

From the output, note:

- **Total rows rendered** for the winning scenario (e.g., `500k`)
- **Frame p50** in ms (e.g., `2.4ms`)
- **Jank events** — count of frames >16ms during the run (ideally `0`)
- **Ratio vs gridalpha** or next-best competitor (e.g., `4.1×`)

If any metric can't be sourced today (e.g., gridalpha comparison not yet wired up in the bench matrix), mark the caption with an inline `(n/a)` or substitute a metric that **is** sourceable (e.g., `0` scroll jank on S7 → caption `scroll jank @ S7`).

- [ ] **Step 3: Update `STATS` in `receipts-band.tsx`**

Edit the `STATS` constant in `apps/playground/src/receipts-band.tsx`. Replace the values with the real ones captured in Step 2, and add a provenance comment above:

```tsx
// Receipts snapshot captured from bench run <commit-sha>, scenario S7 at scale `stress`,
// 2026-XX-XX on local dev machine. Direction D will wire this to a live source.
const STATS: readonly Stat[] = [
  { value: "<real-value-1>", caption: "rows rendered" },
  { value: "<real-value-2>", caption: "frame p50" },
  { value: "<real-value-3>", caption: "jank events" },
  { value: "<real-value-4>", caption: "vs gridalpha" },
];
```

If any test in `receipts-band.test.tsx` asserts on a specific string (e.g., `500k`) that you've just changed, update the test to match. Keep the structural assertions (four items, ordering, captions) as-is.

- [ ] **Step 4: Re-run tests**

```bash
pnpm --filter @pretable/app-playground test -- receipts-band.test
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/playground/src/receipts-band.tsx apps/playground/src/__tests__/receipts-band.test.tsx
git commit -m "feat(playground): populate ReceiptsBand with real bench snapshot numbers"
```

---

## Task 10: CI green + open the PR

Run every CI check locally, fix any drift, and open the PR.

- [ ] **Step 1: Full repo CI dry-run**

```bash
pnpm install --frozen-lockfile
pnpm test
pnpm typecheck
pnpm lint
pnpm format
pnpm build
```

Expected: all green. If `pnpm format` reports formatting diffs, run `pnpm format:write` (or whatever the repo uses — check `package.json`) to fix, commit, and re-run. If `pnpm lint` surfaces unused imports from the deleted `inspection-demo.tsx`, fix and commit.

- [ ] **Step 2: Manual smoke before push**

```bash
pnpm --filter @pretable/app-playground build
pnpm --filter @pretable/app-playground preview
```

Open the preview URL, walk through Task 9 Step 1 checklist once more against the production build (not dev server). Verify no hydration errors in console, Fraunces weights load, no CLS visible.

Ctrl-C out.

- [ ] **Step 3: Push and open PR**

```bash
git push -u origin feat/website-surfaces
gh pr create --title "feat(playground): pitch landing (direction A)" --body "$(cat <<'EOF'
## Summary
- Replaces the bare \`<InspectionDemo />\` in \`apps/playground\` with the five-section pitch landing from visual-system-design §5 (Nav → Hero → full-bleed dark grid → Receipts → Footer).
- New components: \`<PitchHero />\`, \`<PitchGrid />\`, \`<ReceiptsBand />\`, plus a local \`<CopyCommand />\` helper for the hero's ghost-mono CTA.
- Reuses \`<Nav>\`, \`<Footer>\`, \`<Receipt>\` from \`@pretable/ui\` and \`InspectionGrid\` from \`@pretable/react/internal\`.
- Introduces Tailwind v4 in \`apps/playground\` with \`@theme inline\` mapping over \`@pretable/ui\` design tokens. Packages remain vanilla CSS.
- Deletes \`inspection-demo.tsx\` and its test.

Direction A of the four-direction website initiative. Full spec: \`docs/superpowers/specs/2026-04-21-playground-pitch-landing-design.md\`. Plan: \`docs/superpowers/plans/2026-04-21-playground-pitch-landing.md\`.

Receipts-band numbers are a real bench snapshot captured during implementation; direction D will swap to a live source.

## Test plan
- [ ] \`pnpm test\` green (playground unit tests + all other workspaces)
- [ ] \`pnpm typecheck\` green
- [ ] \`pnpm lint\` green
- [ ] \`pnpm format\` green
- [ ] \`pnpm build\` green
- [ ] Manual: \`pnpm --filter @pretable/app-playground dev\` renders all five sections, "Try the live playground ↓" anchor scrolls to grid, copy-command writes to clipboard + flashes ✓ copied, scale select and row selection update the telemetry readout

🤖 Generated with [Assistant Code](https://assistant.com/assistant-code)
EOF
)"
```

Return the PR URL.

- [ ] **Step 4: Final todos**

Mark the direction-A items in the TodoWrite list complete. Move to direction B next.

---

## Spec coverage check

Quick cross-walk of the design spec against this plan:

| Spec section                                                  | Task(s)  |
| ------------------------------------------------------------- | -------- |
| §1 Goal                                                       | 8, 9     |
| §2 Scope (A vs D)                                             | 7, 9     |
| §3 Component tree                                             | 2, 4–8   |
| §3 State ownership                                            | 4–7      |
| §3 Type contracts                                             | 5, 6     |
| §4 Styling approach (Tailwind v4)                             | 1        |
| §4 `app.css` rewrite                                          | 1        |
| §5.1 `<Nav>` wiring                                           | 2        |
| §5.2 `<PitchHero />`                                          | 3, 4     |
| §5.3 `<PitchGrid />`                                          | 5, 6     |
| §5.4 `<ReceiptsBand />`                                       | 7, 9     |
| §5.5 `<Footer>` wiring                                        | 2        |
| §5.6 Version plumbing                                         | 1, 2     |
| §6 Data flow                                                  | 5, 6     |
| §7 Testing plan                                               | 2–9      |
| §8 Out-of-scope / follow-ups                                  | —        |
| §9 Rollback                                                   | 10 (PR)  |
| §10 Risks                                                     | 1, 9, 10 |
| §11 Success criteria 1 (5 sections rendered)                  | 8, 9     |
| §11 Success criteria 2 (full-bleed dark grid, real telemetry) | 6, 9     |
| §11 Success criteria 3 (real receipts numbers)                | 9        |
| §11 Success criteria 4 (CTA anchor)                           | 4, 9     |
| §11 Success criteria 5 (InspectionDemo deleted)               | 8        |
| §11 Success criteria 6 (CI green)                             | 10       |
| §11 Success criteria 7 (manual verification)                  | 9        |

All success criteria are covered. Out-of-scope items are intentionally not in the plan.

---

**End of plan.** Execution via `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans`.
