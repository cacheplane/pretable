# Pretable UI Package Implementation Plan (Plan A)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Create `packages/ui` — the shared design-system package containing CSS tokens, Fraunces font wiring, and five shared React components (`<Receipt>`, `<Callout>`, `<CodeBlock>`, `<Nav>`, `<Footer>`) that the playground, bench, and docs apps will all consume.

**Architecture:** New pnpm workspace package `@pretable/ui` following the same conventions as `@pretable/react`: TypeScript source, tsup for JS bundling, `tsc -p tsconfig.build.json` for declaration files, vitest for unit tests (JSDOM). CSS ships as static files (`tokens.css`, `components.css`) copied from `src/` to `dist/` at build time. Font loading uses `@fontsource-variable/fraunces` so consumers can `import "@fontsource-variable/fraunces"` directly — no self-hosted font files in this package. Component API is purely presentational (no React context, no global state); theming is done entirely through the CSS custom properties in `tokens.css`.

**Tech Stack:** TypeScript 5, React 19.2, tsup 8.5, vitest 4 (JSDOM environment), `@testing-library/react`, `@testing-library/jest-dom`, `@fontsource-variable/fraunces` (runtime dep).

**Scope boundaries (read before starting):**

- Plan A ships the `@pretable/ui` package only. It does NOT yet wire any of the existing apps (playground, bench) to use it. Apps migration is Plans B and C.
- Plan A does NOT ship `<SearchModal>`. Search is docs-specific and will be implemented in Plan D alongside the MDX content index.
- Plan A does NOT migrate existing `apps/*/src/app.css` files. That work belongs in Plans B and C.
- Design spec: [`docs/superpowers/specs/2026-04-21-pretable-visual-system-design.md`](../specs/2026-04-21-pretable-visual-system-design.md). Read §3 (tokens) and §7 (component chrome) before starting any implementation task.

---

## File Structure

### New files

```
packages/ui/
├── package.json
├── README.md                        (one-pager describing the package)
├── tsconfig.json
├── tsconfig.build.json
├── tsconfig.typecheck.json
├── tsup.config.ts
├── vitest.config.ts
└── src/
    ├── index.ts                      (barrel — re-exports all components)
    ├── tokens.css                    (CSS custom properties: --cream, --ink, etc.)
    ├── components.css                (shared class rules for .pt-nav, .pt-footer, etc.)
    ├── fonts.ts                      (re-export of @fontsource-variable/fraunces for convenience)
    ├── receipt.tsx                   (<Receipt> inline tag)
    ├── callout.tsx                   (<Callout> with variant prop)
    ├── code-block.tsx                (<CodeBlock> with tabs + copy + line highlights)
    ├── nav.tsx                       (<Nav> 60px sticky header)
    ├── footer.tsx                    (<Footer> monospace one-line footer)
    └── __tests__/
        ├── receipt.test.tsx
        ├── callout.test.tsx
        ├── code-block.test.tsx
        ├── nav.test.tsx
        └── footer.test.tsx
```

### Modified files

- `pnpm-workspace.yaml` — no change expected (already globs `packages/*`); verify during scaffold.
- Root `package.json` — no changes (devDependencies are workspace-level; we'll add `@testing-library/*` only if not already present, which they are per `package.json:28-31`).

Each file has one clear responsibility:

- `tokens.css` — ONLY the CSS variable definitions under `:root`. No selectors beyond `:root`.
- `components.css` — class-level rules (`.pt-nav`, `.pt-footer`, `.pt-code-block`, etc.) using the variables from `tokens.css`. Consumer imports both.
- Each `.tsx` file — ONE component + its TypeScript type. Default export the component; named export the prop type.
- Each test file — unit tests for ONE component. Use `@testing-library/react`'s `render`, assert on DOM class names + text content + ARIA attributes.

---

## Architectural decisions resolved from spec §10 open questions

Before writing any task steps, these five open questions from the spec are locked in:

1. **Styling approach:** Vanilla CSS files (`tokens.css`, `components.css`) co-located with components, copied from `src/` to `dist/` at build time via a tsup `onSuccess` hook. No Tailwind, no CSS-in-JS runtime. Consumers `import "@pretable/ui/tokens.css"` and `import "@pretable/ui/components.css"` once in their main entry file.
2. **Font hosting:** `@fontsource-variable/fraunces` as a runtime dep. Consumers `import "@fontsource-variable/fraunces"` in their main entry file. We do not self-host WOFF2 files in this package.
3. **MDX toolchain:** Not in Plan A scope — resolved in Plan D.
4. **Search index:** Not in Plan A scope — resolved in Plan D.
5. **CI history chart:** Not in Plan A scope — resolved in Plan C.

---

## Task 1: Scaffold the package

**Files:**

- Create: `packages/ui/package.json`
- Create: `packages/ui/tsconfig.json`
- Create: `packages/ui/tsconfig.build.json`
- Create: `packages/ui/tsconfig.typecheck.json`
- Create: `packages/ui/tsup.config.ts`
- Create: `packages/ui/vitest.config.ts`
- Create: `packages/ui/README.md`
- Create: `packages/ui/src/index.ts` (empty barrel for now)
- Modify: `pnpm-workspace.yaml` (verify glob covers `packages/*`; no change needed)

- [ ] **Step 1: Create `packages/ui/package.json`**

```json
{
  "name": "@pretable/ui",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "files": ["dist"],
  "main": "./dist/index.js",
  "module": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.js"
    },
    "./tokens.css": "./dist/tokens.css",
    "./components.css": "./dist/components.css"
  },
  "peerDependencies": {
    "react": "^19.0.0"
  },
  "dependencies": {
    "@fontsource-variable/fraunces": "^5.0.0"
  },
  "scripts": {
    "build": "tsup && tsc -p tsconfig.build.json",
    "lint": "eslint src --ext .ts,.tsx",
    "test": "vitest run --environment jsdom",
    "typecheck": "tsc -p tsconfig.typecheck.json --noEmit"
  }
}
```

Note: `private: true` keeps it from publishing to npm. It's still consumed by apps via workspace linking.

- [ ] **Step 2: Create `packages/ui/tsconfig.json`**

Look at `packages/react/tsconfig.json` first for the exact shape to match. Then create:

```json
{
  "extends": "../../tsconfig.react.json",
  "compilerOptions": {
    "baseUrl": ".",
    "outDir": "dist"
  },
  "include": ["src"],
  "exclude": ["src/**/*.test.*", "src/**/__tests__/**"]
}
```

- [ ] **Step 3: Create `packages/ui/tsconfig.build.json`**

```json
{
  "extends": "./tsconfig.json",
  "compilerOptions": {
    "baseUrl": ".",
    "composite": false,
    "emitDeclarationOnly": true,
    "noEmit": false,
    "rootDir": "src"
  }
}
```

- [ ] **Step 4: Create `packages/ui/tsconfig.typecheck.json`**

```json
{
  "extends": "./tsconfig.json",
  "compilerOptions": {
    "noEmit": true
  },
  "include": ["src"],
  "exclude": []
}
```

This is the one used by `pnpm typecheck`; it includes tests so type errors in tests are caught.

- [ ] **Step 5: Create `packages/ui/tsup.config.ts`**

```ts
import { defineConfig } from "tsup";

export default defineConfig({
  clean: true,
  dts: false,
  entry: ["src/index.ts"],
  external: ["react", "react-dom"],
  format: ["esm"],
  onSuccess:
    "cp src/tokens.css dist/tokens.css && cp src/components.css dist/components.css",
});
```

The `onSuccess` hook copies the CSS files from source to dist. This runs once after every successful build. If the project later adds more CSS files, update this command.

- [ ] **Step 6: Create `packages/ui/vitest.config.ts`**

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "jsdom",
    setupFiles: [],
  },
});
```

- [ ] **Step 7: Create `packages/ui/src/index.ts` (empty barrel placeholder)**

```ts
// Barrel export. Components are added in subsequent tasks.
export {};
```

- [ ] **Step 8: Create `packages/ui/README.md`**

````markdown
# @pretable/ui

Shared design-system primitives for the pretable apps (playground, bench, docs).

## Usage

In your app's main entry:

```tsx
import "@fontsource-variable/fraunces";
import "@pretable/ui/tokens.css";
import "@pretable/ui/components.css";

import { Nav, Footer, Receipt, Callout, CodeBlock } from "@pretable/ui";
```
````

All theming is done via CSS custom properties defined in `tokens.css`. Override any variable at a more specific scope to retheme.

## Design spec

See [`docs/superpowers/specs/2026-04-21-pretable-visual-system-design.md`](../../docs/superpowers/specs/2026-04-21-pretable-visual-system-design.md) in this repo.

````

- [ ] **Step 9: Install dependencies**

Run from repo root:

```bash
pnpm install
````

Expected: `pnpm install` creates `packages/ui/node_modules` with `@fontsource-variable/fraunces`, symlinks workspace packages, and the new package is recognized. If pnpm warns about an unknown workspace package, check that `pnpm-workspace.yaml` covers `packages/*`.

- [ ] **Step 10: Verify scaffold builds**

```bash
pnpm --filter @pretable/ui build
```

Expected: tsup builds `dist/index.js` (empty-ish, since `src/index.ts` is just `export {};`). Note: the `onSuccess` hook may error because `src/tokens.css` doesn't exist yet — that's expected. We'll add the files in Task 2. If you want the build to stay green between tasks, create stub files:

```bash
touch packages/ui/src/tokens.css packages/ui/src/components.css
pnpm --filter @pretable/ui build
```

Expected: clean build. `dist/` contains `index.js`, `index.d.ts`, `tokens.css`, `components.css`.

- [ ] **Step 11: Commit**

```bash
git add packages/ui pnpm-lock.yaml
git commit -m "chore(ui): scaffold @pretable/ui workspace package"
```

---

## Task 2: Write the design tokens CSS file

**Files:**

- Modify: `packages/ui/src/tokens.css` (replace stub with real tokens)

The tokens come directly from spec §3. This is a content-only task — no tests (CSS variables can be eyeballed at the end; apps consuming them in Plans B-D provide de-facto tests).

- [ ] **Step 1: Write `packages/ui/src/tokens.css`**

```css
/**
 * pretable design tokens
 *
 * Consumer imports this file once at the app's entry point. All component
 * styles in components.css reference these variables. To retheme, override
 * any variable at a more specific scope (e.g. [data-theme="dark"]).
 *
 * See design spec §3 for palette rationale and WCAG contrast ratings.
 */
:root {
  /* Editorial — marketing / playground chrome / docs prose */
  --pt-cream: #ede5d4;
  --pt-cream-hi: #f5eedd;
  --pt-cream-lo: #e0d6bf;
  --pt-cream-rule: #cdc3aa;
  --pt-ink: #1a1815;
  --pt-ink-dim: #4a443b;
  --pt-ink-softer: #7a7468;
  --pt-amber-ink: #8a5d0f;
  --pt-amber: #c68a1e;
  --pt-amber-soft: #f5e8ca;

  /* Terminal — grid surface, bench, code blocks */
  --pt-dark: #0f0e0c;
  --pt-grid-bg: #0b0a09;
  --pt-grid-raised: #151310;
  --pt-grid-rule: #1f1c18;
  --pt-grid-text: #d8d2c3;
  --pt-grid-dim: #8f8a7d;

  /* Severity — only saturated color in the system */
  --pt-sev-info: #6fa9c9;
  --pt-sev-warn: #d9a44f;
  --pt-sev-err: #d3615a;
  --pt-sev-ok: #7ea86f;

  /* Syntax highlighting (maps to severity family) */
  --pt-code-key: #d9a44f;
  --pt-code-str: #7ea86f;
  --pt-code-fn: #6fa9c9;
  --pt-code-com: #6a6359;
  --pt-code-prop: #c9a47e;

  /* Typography stacks */
  --pt-font-serif: "Fraunces", Georgia, "Times New Roman", serif;
  --pt-font-sans:
    ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto,
    "Helvetica Neue", sans-serif;
  --pt-font-mono:
    ui-monospace, SFMono-Regular, Menlo, "Cascadia Code", "Roboto Mono",
    monospace;

  /* Type scale */
  --pt-fs-display-xl: 60px;
  --pt-fs-display-lg: 44px;
  --pt-fs-display-md: 32px;
  --pt-fs-dek: 18px;
  --pt-fs-body: 15px;
  --pt-fs-ui: 13.5px;
  --pt-fs-eyebrow: 11px;
  --pt-fs-data: 12.5px;

  /* Layout tokens (used primarily by docs) */
  --pt-page-max: 1440px;
  --pt-header-h: 60px;
  --pt-sidebar-w: 260px;
  --pt-toc-w: 224px;
  --pt-prose-max: 720px;
  --pt-code-max: 900px;
  --pt-modal-w: 560px;
}
```

Prefix note: we use `--pt-*` (not `--cream` bare) to avoid collision with other design systems in consumer apps.

- [ ] **Step 2: Verify the file parses as valid CSS**

```bash
pnpm --filter @pretable/ui build
```

Expected: clean build with `dist/tokens.css` present.

- [ ] **Step 3: Commit**

```bash
git add packages/ui/src/tokens.css
git commit -m "feat(ui): add design tokens (palette, typography, layout)"
```

---

## Task 3: Write the `<Receipt>` component

**Files:**

- Create: `packages/ui/src/receipt.tsx`
- Create: `packages/ui/src/__tests__/receipt.test.tsx`
- Modify: `packages/ui/src/components.css` (add `.pt-receipt` rule)
- Modify: `packages/ui/src/index.ts` (export Receipt)

`<Receipt>` is the simplest component — an inline tag for numeric receipts in body copy, e.g. `<Receipt>60fps</Receipt>` rendering as an ink-filled mono chip.

- [ ] **Step 1: Write the failing test**

Create `packages/ui/src/__tests__/receipt.test.tsx`:

```tsx
import "@testing-library/jest-dom/vitest";
import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { Receipt } from "../receipt";

describe("Receipt", () => {
  it("renders an inline <span> with class pt-receipt and the given content", () => {
    const { container } = render(<Receipt>60fps</Receipt>);
    const span = container.querySelector("span.pt-receipt");
    expect(span).toBeInTheDocument();
    expect(span).toHaveTextContent("60fps");
  });

  it("accepts and merges a custom className", () => {
    const { container } = render(<Receipt className="custom">500k</Receipt>);
    const span = container.querySelector("span.pt-receipt");
    expect(span).toHaveClass("pt-receipt", "custom");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
pnpm --filter @pretable/ui test
```

Expected: fail with "Cannot find module '../receipt'" or similar — the component doesn't exist yet.

- [ ] **Step 3: Write `packages/ui/src/receipt.tsx`**

```tsx
import type { ReactNode } from "react";

export interface ReceiptProps {
  children: ReactNode;
  className?: string;
}

export function Receipt({ children, className }: ReceiptProps) {
  const classes = ["pt-receipt", className].filter(Boolean).join(" ");
  return <span className={classes}>{children}</span>;
}
```

- [ ] **Step 4: Add the CSS rule to `packages/ui/src/components.css`**

Create or append to the file:

```css
/* ------------------------------------------------------------- */
/* Receipt — inline numeric tag in body copy                     */
/* ------------------------------------------------------------- */
.pt-receipt {
  display: inline-block;
  padding: 2px 7px;
  margin: 0 1px;
  border-radius: 3px;
  background: var(--pt-ink);
  color: var(--pt-cream);
  font-family: var(--pt-font-mono);
  font-size: 0.88em;
  letter-spacing: 0.01em;
  vertical-align: 2px;
  white-space: nowrap;
}
```

- [ ] **Step 5: Export from the barrel**

Replace `packages/ui/src/index.ts` contents with:

```ts
export { Receipt, type ReceiptProps } from "./receipt";
```

- [ ] **Step 6: Run the test to verify it passes**

```bash
pnpm --filter @pretable/ui test
```

Expected: 2 passed.

- [ ] **Step 7: Commit**

```bash
git add packages/ui/src/receipt.tsx packages/ui/src/__tests__/receipt.test.tsx packages/ui/src/components.css packages/ui/src/index.ts
git commit -m "feat(ui): add Receipt inline-tag component"
```

---

## Task 4: Write the `<Callout>` component

**Files:**

- Create: `packages/ui/src/callout.tsx`
- Create: `packages/ui/src/__tests__/callout.test.tsx`
- Modify: `packages/ui/src/components.css` (add `.pt-callout` rules)
- Modify: `packages/ui/src/index.ts`

`<Callout>` has two visual variants: default (amber-ink left border) and `warn` (amber/warn-yellow left border). Shape:

```tsx
<Callout tag="Requirements">React 18.3+ or React 19.</Callout>
<Callout variant="warn" tag="Columns must be stable">Declare outside the component.</Callout>
```

- [ ] **Step 1: Write the failing test**

Create `packages/ui/src/__tests__/callout.test.tsx`:

```tsx
import "@testing-library/jest-dom/vitest";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { Callout } from "../callout";

describe("Callout", () => {
  it("renders with the default variant (class pt-callout, no variant modifier)", () => {
    const { container } = render(
      <Callout tag="Requirements">React 18.3+</Callout>,
    );
    const root = container.querySelector("div.pt-callout");
    expect(root).toBeInTheDocument();
    expect(root).not.toHaveClass("pt-callout-warn");
    expect(screen.getByText("Requirements")).toHaveClass("pt-callout-tag");
    expect(screen.getByText("React 18.3+")).toBeInTheDocument();
  });

  it("applies the warn variant modifier when variant='warn'", () => {
    const { container } = render(
      <Callout variant="warn" tag="Watch out">
        Something
      </Callout>,
    );
    const root = container.querySelector("div.pt-callout");
    expect(root).toHaveClass("pt-callout", "pt-callout-warn");
  });

  it("renders children without requiring a tag", () => {
    render(<Callout>Just a body</Callout>);
    expect(screen.getByText("Just a body")).toBeInTheDocument();
    expect(screen.queryByText(/^(Requirements|Watch)/)).toBeNull();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
pnpm --filter @pretable/ui test
```

Expected: fail with "Cannot find module '../callout'".

- [ ] **Step 3: Write `packages/ui/src/callout.tsx`**

```tsx
import type { ReactNode } from "react";

export type CalloutVariant = "default" | "warn";

export interface CalloutProps {
  children: ReactNode;
  tag?: string;
  variant?: CalloutVariant;
  className?: string;
}

export function Callout({
  children,
  tag,
  variant = "default",
  className,
}: CalloutProps) {
  const classes = [
    "pt-callout",
    variant === "warn" ? "pt-callout-warn" : null,
    className,
  ]
    .filter(Boolean)
    .join(" ");
  return (
    <div className={classes}>
      {tag ? <span className="pt-callout-tag">{tag}</span> : null}
      <span className="pt-callout-body">{children}</span>
    </div>
  );
}
```

- [ ] **Step 4: Add the CSS rules to `packages/ui/src/components.css`**

Append:

```css
/* ------------------------------------------------------------- */
/* Callout — cream-hi panel with accented left border            */
/* ------------------------------------------------------------- */
.pt-callout {
  background: var(--pt-cream-hi);
  border-left: 3px solid var(--pt-amber-ink);
  border-radius: 0 6px 6px 0;
  padding: 14px 18px;
  margin: 22px 0;
  max-width: 720px;
  font-family: var(--pt-font-sans);
  font-size: 14px;
  line-height: 1.55;
  color: var(--pt-ink-dim);
}
.pt-callout-warn {
  border-left-color: var(--pt-sev-warn);
}
.pt-callout-tag {
  display: block;
  margin-bottom: 5px;
  color: var(--pt-ink);
  font-family: var(--pt-font-mono);
  font-size: 10.5px;
  font-weight: 700;
  letter-spacing: 0.12em;
  text-transform: uppercase;
}
.pt-callout-warn .pt-callout-tag {
  color: #7d4f0a;
}
.pt-callout-body {
  display: block;
}
```

- [ ] **Step 5: Export from the barrel**

Update `packages/ui/src/index.ts`:

```ts
export { Callout, type CalloutProps, type CalloutVariant } from "./callout";
export { Receipt, type ReceiptProps } from "./receipt";
```

- [ ] **Step 6: Run tests to verify they pass**

```bash
pnpm --filter @pretable/ui test
```

Expected: 5 passed (2 from Receipt + 3 from Callout).

- [ ] **Step 7: Commit**

```bash
git add packages/ui/src/callout.tsx packages/ui/src/__tests__/callout.test.tsx packages/ui/src/components.css packages/ui/src/index.ts
git commit -m "feat(ui): add Callout component with default and warn variants"
```

---

## Task 5: Write the `<CodeBlock>` component

**Files:**

- Create: `packages/ui/src/code-block.tsx`
- Create: `packages/ui/src/__tests__/code-block.test.tsx`
- Modify: `packages/ui/src/components.css`
- Modify: `packages/ui/src/index.ts`

`<CodeBlock>` wraps a block of pre-formatted code with:

- Optional tabs row for multi-language (`npm` / `pnpm` / `yarn`) or source variant (`TypeScript` / `JavaScript`)
- Copy button in the top-right
- Dark terminal surface styling via CSS

For v1 we do NOT ship syntax highlighting as a runtime feature — the consumer is responsible for marking up the code with `<span>` elements bearing severity classes (`.pt-code-key`, `.pt-code-str`, etc.). A future task can add a build-time highlighter.

API shape:

```tsx
<CodeBlock
  tabs={[
    { label: "npm", content: "npm install @pretable/react" },
    { label: "pnpm", content: "pnpm add @pretable/react" },
  ]}
/>
```

Or the simpler single-snippet form:

```tsx
<CodeBlock label="TypeScript">
  {/* children = pre-formatted JSX with syntax spans */}
</CodeBlock>
```

- [ ] **Step 1: Write the failing test**

Create `packages/ui/src/__tests__/code-block.test.tsx`:

```tsx
import "@testing-library/jest-dom/vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

import { CodeBlock } from "../code-block";

describe("CodeBlock", () => {
  beforeEach(() => {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: vi.fn().mockResolvedValue(undefined) },
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("renders a single snippet with a language label and copy button", () => {
    render(
      <CodeBlock label="bash">
        <span>npm install @pretable/react</span>
      </CodeBlock>,
    );
    expect(screen.getByText("bash")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /copy/i })).toBeInTheDocument();
    expect(screen.getByText("npm install @pretable/react")).toBeInTheDocument();
  });

  it("renders a row of tabs and shows only the active tab's content", () => {
    render(
      <CodeBlock
        tabs={[
          { label: "npm", content: "npm install @pretable/react" },
          { label: "pnpm", content: "pnpm add @pretable/react" },
        ]}
      />,
    );
    expect(screen.getByText("npm")).toHaveClass("pt-code-tab", "active");
    expect(screen.getByText("pnpm")).toHaveClass("pt-code-tab");
    expect(screen.getByText("pnpm")).not.toHaveClass("active");
    expect(screen.getByText("npm install @pretable/react")).toBeInTheDocument();
    expect(
      screen.queryByText("pnpm add @pretable/react"),
    ).not.toBeInTheDocument();
  });

  it("switches tabs on click and updates active content", () => {
    render(
      <CodeBlock
        tabs={[
          { label: "npm", content: "npm install X" },
          { label: "pnpm", content: "pnpm add X" },
        ]}
      />,
    );
    fireEvent.click(screen.getByText("pnpm"));
    expect(screen.getByText("pnpm add X")).toBeInTheDocument();
    expect(screen.queryByText("npm install X")).not.toBeInTheDocument();
    expect(screen.getByText("pnpm")).toHaveClass("active");
  });

  it("copies the visible snippet to the clipboard when the copy button is clicked", async () => {
    render(<CodeBlock label="shell">npm install @pretable/react</CodeBlock>);
    fireEvent.click(screen.getByRole("button", { name: /copy/i }));
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(
      "npm install @pretable/react",
    );
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
pnpm --filter @pretable/ui test
```

Expected: fail with "Cannot find module '../code-block'".

- [ ] **Step 3: Write `packages/ui/src/code-block.tsx`**

```tsx
import { useRef, useState, type ReactNode } from "react";

export interface CodeBlockTab {
  label: string;
  content: ReactNode;
}

export interface CodeBlockProps {
  /** Single-snippet label shown in the header (mutually exclusive with `tabs`). */
  label?: string;
  /** Multi-snippet tabs. When provided, `label` and `children` are ignored. */
  tabs?: CodeBlockTab[];
  /** Body content when not using `tabs`. */
  children?: ReactNode;
  className?: string;
}

export function CodeBlock({
  label,
  tabs,
  children,
  className,
}: CodeBlockProps) {
  const [activeIdx, setActiveIdx] = useState(0);
  const preRef = useRef<HTMLPreElement | null>(null);
  const [copied, setCopied] = useState(false);

  const classes = ["pt-code-block", className].filter(Boolean).join(" ");

  const onCopy = async () => {
    const text = preRef.current?.innerText ?? "";
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch {
      // Clipboard API can fail in insecure contexts. Silent no-op is fine —
      // the user can still select + copy manually.
    }
  };

  return (
    <div className={classes}>
      <div className="pt-code-head">
        <div className="pt-code-tabs">
          {tabs ? (
            tabs.map((tab, i) => {
              const tabClasses = [
                "pt-code-tab",
                i === activeIdx ? "active" : null,
              ]
                .filter(Boolean)
                .join(" ");
              return (
                <button
                  key={tab.label}
                  type="button"
                  className={tabClasses}
                  onClick={() => setActiveIdx(i)}
                >
                  {tab.label}
                </button>
              );
            })
          ) : label ? (
            <span className="pt-code-tab active">{label}</span>
          ) : null}
        </div>
        <button
          type="button"
          className="pt-code-copy"
          onClick={onCopy}
          aria-label="Copy code"
        >
          {copied ? "✓ copied" : "⎘ copy"}
        </button>
      </div>
      <pre ref={preRef} className="pt-code-body">
        {tabs ? tabs[activeIdx]?.content : children}
      </pre>
    </div>
  );
}
```

- [ ] **Step 4: Add the CSS rules to `packages/ui/src/components.css`**

Append:

```css
/* ------------------------------------------------------------- */
/* CodeBlock — terminal surface with tabs + copy                 */
/* ------------------------------------------------------------- */
.pt-code-block {
  max-width: var(--pt-code-max);
  margin: 18px 0 22px;
  background: var(--pt-grid-bg);
  color: var(--pt-grid-text);
  border: 1px solid var(--pt-grid-rule);
  border-radius: 8px;
  overflow: hidden;
  font-family: var(--pt-font-mono);
  font-size: 13px;
  line-height: 1.62;
}
.pt-code-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  background: #0d0c0a;
  border-bottom: 1px solid var(--pt-grid-rule);
  padding: 0 6px 0 0;
}
.pt-code-tabs {
  display: flex;
}
.pt-code-tab {
  padding: 9px 14px;
  font-family: var(--pt-font-mono);
  font-size: 11px;
  letter-spacing: 0.04em;
  color: var(--pt-grid-dim);
  background: transparent;
  border: 0;
  border-right: 1px solid var(--pt-grid-rule);
  cursor: pointer;
}
.pt-code-tab.active {
  color: var(--pt-amber);
  background: var(--pt-grid-bg);
}
.pt-code-copy {
  font-family: var(--pt-font-mono);
  font-size: 10.5px;
  color: var(--pt-grid-dim);
  background: transparent;
  border: 1px solid var(--pt-grid-rule);
  border-radius: 3px;
  padding: 4px 9px;
  margin: 6px 10px;
  cursor: pointer;
}
.pt-code-copy:hover {
  color: var(--pt-amber);
}
.pt-code-body {
  padding: 16px 20px;
  margin: 0;
  overflow-x: auto;
  white-space: pre;
}
/* Syntax highlighting classes — consumers apply these to spans inside the body. */
.pt-code-key {
  color: var(--pt-code-key);
}
.pt-code-str {
  color: var(--pt-code-str);
}
.pt-code-fn {
  color: var(--pt-code-fn);
}
.pt-code-com {
  color: var(--pt-code-com);
  font-style: italic;
}
.pt-code-prop {
  color: var(--pt-code-prop);
}
```

- [ ] **Step 5: Export from the barrel**

Update `packages/ui/src/index.ts`:

```ts
export { Callout, type CalloutProps, type CalloutVariant } from "./callout";
export {
  CodeBlock,
  type CodeBlockProps,
  type CodeBlockTab,
} from "./code-block";
export { Receipt, type ReceiptProps } from "./receipt";
```

- [ ] **Step 6: Run tests to verify they pass**

```bash
pnpm --filter @pretable/ui test
```

Expected: 9 passed (2 Receipt + 3 Callout + 4 CodeBlock).

- [ ] **Step 7: Commit**

```bash
git add packages/ui/src/code-block.tsx packages/ui/src/__tests__/code-block.test.tsx packages/ui/src/components.css packages/ui/src/index.ts
git commit -m "feat(ui): add CodeBlock with tabs and copy-to-clipboard"
```

---

## Task 6: Write the `<Nav>` component

**Files:**

- Create: `packages/ui/src/nav.tsx`
- Create: `packages/ui/src/__tests__/nav.test.tsx`
- Modify: `packages/ui/src/components.css`
- Modify: `packages/ui/src/index.ts`

`<Nav>` is the shared 60px sticky header. It renders the wordmark, an optional version pill, the page links (with active highlighting), an optional search trigger (rendered as a button for v1; docs will wire `Cmd+K` behavior in Plan D), an optional GitHub star display, and an optional right-side CTA.

API:

```tsx
<Nav
  version="0.4"
  active="playground"
  githubStars={1200}
  cta={{ label: "Try playground →", href: "/" }}
  onSearchClick={() => {
    /* opens modal in Plan D */
  }}
/>
```

- [ ] **Step 1: Write the failing test**

Create `packages/ui/src/__tests__/nav.test.tsx`:

```tsx
import "@testing-library/jest-dom/vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { Nav } from "../nav";

describe("Nav", () => {
  it("renders the wordmark as 'pretable.' with an amber period span", () => {
    const { container } = render(<Nav active="playground" />);
    const brand = container.querySelector(".pt-nav-brand");
    expect(brand).toBeInTheDocument();
    expect(brand).toHaveTextContent("pretable.");
    const caret = container.querySelector(".pt-nav-brand .pt-nav-caret");
    expect(caret).toBeInTheDocument();
    expect(caret).toHaveTextContent(".");
  });

  it("renders the version pill when version prop is provided", () => {
    render(<Nav active="playground" version="0.4" />);
    expect(screen.getByText("v")).toBeInTheDocument();
    expect(screen.getByText("0.4")).toBeInTheDocument();
  });

  it("renders three standard links with the active one marked", () => {
    const { container } = render(<Nav active="bench" />);
    const links = Array.from(container.querySelectorAll(".pt-nav-link"));
    expect(links).toHaveLength(4); // playground, bench, docs, github
    const active = container.querySelector(".pt-nav-link.active");
    expect(active).toHaveTextContent(/bench/i);
  });

  it("renders the search trigger and invokes onSearchClick when clicked", () => {
    const onSearchClick = vi.fn();
    render(<Nav active="docs" onSearchClick={onSearchClick} />);
    const search = screen.getByRole("button", {
      name: /search the docs/i,
    });
    fireEvent.click(search);
    expect(onSearchClick).toHaveBeenCalledOnce();
  });

  it("renders the GitHub stars count when githubStars is provided", () => {
    render(<Nav active="playground" githubStars={1234} />);
    expect(screen.getByText("1.2k")).toBeInTheDocument();
  });

  it("renders the CTA button when cta is provided", () => {
    render(
      <Nav
        active="playground"
        cta={{ label: "Try playground →", href: "/" }}
      />,
    );
    const cta = screen.getByRole("link", { name: /try playground/i });
    expect(cta).toHaveAttribute("href", "/");
    expect(cta).toHaveClass("pt-nav-cta");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
pnpm --filter @pretable/ui test
```

Expected: fail with "Cannot find module '../nav'".

- [ ] **Step 3: Write `packages/ui/src/nav.tsx`**

```tsx
export type NavPage = "playground" | "bench" | "docs" | "github";

export interface NavCta {
  label: string;
  href: string;
}

export interface NavProps {
  active: NavPage;
  version?: string;
  githubStars?: number;
  cta?: NavCta;
  onSearchClick?: () => void;
  className?: string;
}

const LINKS: Array<{ id: NavPage; label: string; href: string }> = [
  { id: "playground", label: "playground", href: "/" },
  { id: "bench", label: "bench", href: "/bench" },
  { id: "docs", label: "docs", href: "/docs" },
  {
    id: "github",
    label: "github",
    href: "https://github.com/cacheplane/pretable",
  },
];

function formatStars(n: number): string {
  if (n >= 1000) {
    const k = n / 1000;
    return `${k.toFixed(1)}k`;
  }
  return String(n);
}

export function Nav({
  active,
  version,
  githubStars,
  cta,
  onSearchClick,
  className,
}: NavProps) {
  const classes = ["pt-nav", className].filter(Boolean).join(" ");

  return (
    <header className={classes}>
      <div className="pt-nav-brand-cell">
        <span className="pt-nav-brand">
          pretable<span className="pt-nav-caret">.</span>
        </span>
        {version ? (
          <span className="pt-nav-version">
            v<b>{version}</b>
          </span>
        ) : null}
      </div>
      <nav className="pt-nav-links-cell" aria-label="Primary">
        {LINKS.map((link) => {
          const linkClass = [
            "pt-nav-link",
            link.id === active ? "active" : null,
          ]
            .filter(Boolean)
            .join(" ");
          return (
            <a key={link.id} className={linkClass} href={link.href}>
              {link.label}
            </a>
          );
        })}
      </nav>
      {onSearchClick ? (
        <button
          type="button"
          className="pt-nav-search"
          onClick={onSearchClick}
          aria-label="Search the docs"
        >
          <span className="pt-nav-search-icon" aria-hidden="true">
            ⌕
          </span>
          <span>Search the docs…</span>
          <span className="pt-nav-kbd">⌘K</span>
        </button>
      ) : null}
      <div className="pt-nav-right">
        {githubStars !== undefined ? (
          <span className="pt-nav-gh">
            <span className="pt-nav-star" aria-hidden="true">
              ★
            </span>
            <b>{formatStars(githubStars)}</b>
          </span>
        ) : null}
        {cta ? (
          <a className="pt-nav-cta" href={cta.href}>
            {cta.label}
          </a>
        ) : null}
      </div>
    </header>
  );
}
```

- [ ] **Step 4: Add the CSS rules to `packages/ui/src/components.css`**

Append:

```css
/* ------------------------------------------------------------- */
/* Nav — 60px sticky header, shared across all surfaces          */
/* ------------------------------------------------------------- */
.pt-nav {
  position: sticky;
  top: 0;
  z-index: 20;
  display: grid;
  grid-template-columns: auto 1fr auto auto;
  gap: 24px;
  align-items: center;
  height: var(--pt-header-h);
  padding: 0 28px;
  background: var(--pt-cream);
  border-bottom: 1px solid var(--pt-cream-rule);
  font-family: var(--pt-font-sans);
  font-size: 13px;
  color: var(--pt-ink);
}
.pt-nav-brand-cell {
  display: flex;
  align-items: center;
  gap: 10px;
}
.pt-nav-brand {
  font-family: var(--pt-font-serif);
  font-size: 19px;
  font-weight: 500;
  letter-spacing: -0.02em;
}
.pt-nav-caret {
  color: var(--pt-amber-ink);
}
.pt-nav-version {
  font-family: var(--pt-font-mono);
  font-size: 10.5px;
  padding: 2px 7px;
  border-radius: 3px;
  background: var(--pt-cream-hi);
  border: 1px solid var(--pt-cream-rule);
  color: var(--pt-ink-dim);
}
.pt-nav-version b {
  color: var(--pt-amber-ink);
  font-weight: 600;
}
.pt-nav-links-cell {
  display: flex;
  gap: 24px;
  justify-self: center;
}
.pt-nav-link {
  color: var(--pt-ink-dim);
  text-decoration: none;
  font-family: var(--pt-font-mono);
  font-size: 12px;
}
.pt-nav-link:hover {
  color: var(--pt-ink);
}
.pt-nav-link.active {
  color: var(--pt-ink);
  font-weight: 600;
}
.pt-nav-search {
  display: flex;
  align-items: center;
  gap: 10px;
  max-width: 520px;
  padding: 8px 12px;
  background: var(--pt-cream-hi);
  border: 1px solid var(--pt-cream-rule);
  border-radius: 6px;
  color: var(--pt-ink-dim);
  font-family: var(--pt-font-sans);
  font-size: 13.5px;
  cursor: pointer;
}
.pt-nav-search:hover {
  border-color: var(--pt-ink-softer);
}
.pt-nav-search-icon {
  opacity: 0.5;
}
.pt-nav-kbd {
  margin-left: auto;
  padding: 2px 6px;
  border-radius: 3px;
  background: var(--pt-cream);
  border: 1px solid var(--pt-cream-rule);
  font-family: var(--pt-font-mono);
  font-size: 10.5px;
  color: var(--pt-ink-dim);
}
.pt-nav-right {
  display: flex;
  align-items: center;
  gap: 16px;
}
.pt-nav-gh {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 10px;
  border: 1px solid var(--pt-cream-rule);
  border-radius: 4px;
  font-family: var(--pt-font-mono);
  font-size: 11.5px;
  color: var(--pt-ink-dim);
}
.pt-nav-gh b {
  color: var(--pt-ink);
  font-weight: 600;
}
.pt-nav-star {
  color: var(--pt-amber);
}
.pt-nav-cta {
  padding: 8px 14px;
  background: var(--pt-ink);
  color: var(--pt-cream);
  border-radius: 4px;
  font-family: var(--pt-font-sans);
  font-size: 12.5px;
  font-weight: 600;
  text-decoration: none;
}
.pt-nav-cta:hover {
  background: #0a0806;
}
```

- [ ] **Step 5: Export from the barrel**

Update `packages/ui/src/index.ts`:

```ts
export { Callout, type CalloutProps, type CalloutVariant } from "./callout";
export {
  CodeBlock,
  type CodeBlockProps,
  type CodeBlockTab,
} from "./code-block";
export { Nav, type NavCta, type NavPage, type NavProps } from "./nav";
export { Receipt, type ReceiptProps } from "./receipt";
```

- [ ] **Step 6: Run tests to verify they pass**

```bash
pnpm --filter @pretable/ui test
```

Expected: 15 passed (2 Receipt + 3 Callout + 4 CodeBlock + 6 Nav).

- [ ] **Step 7: Commit**

```bash
git add packages/ui/src/nav.tsx packages/ui/src/__tests__/nav.test.tsx packages/ui/src/components.css packages/ui/src/index.ts
git commit -m "feat(ui): add Nav sticky-header with version pill and search trigger"
```

---

## Task 7: Write the `<Footer>` component

**Files:**

- Create: `packages/ui/src/footer.tsx`
- Create: `packages/ui/src/__tests__/footer.test.tsx`
- Modify: `packages/ui/src/components.css`
- Modify: `packages/ui/src/index.ts`

`<Footer>` is a one-line monospaced footer. Left: wordmark, version, copyright, CI status. Right: links (github, playground, bench, docs, rss).

API:

```tsx
<Footer
  version="0.4"
  ciStatus="green"
  links={[
    { label: "github ↗", href: "https://github.com/cacheplane/pretable" },
    { label: "playground", href: "/" },
  ]}
/>
```

- [ ] **Step 1: Write the failing test**

Create `packages/ui/src/__tests__/footer.test.tsx`:

```tsx
import "@testing-library/jest-dom/vitest";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { Footer } from "../footer";

describe("Footer", () => {
  it("renders wordmark, version, and copyright in the left cell", () => {
    const { container } = render(<Footer version="0.4" ciStatus="green" />);
    const left = container.querySelector(".pt-footer-left");
    expect(left).toBeInTheDocument();
    expect(left).toHaveTextContent("pretable");
    expect(left).toHaveTextContent("0.4");
    expect(left).toHaveTextContent(/MIT/);
  });

  it("renders the CI status dot with green class when ciStatus='green'", () => {
    const { container } = render(<Footer version="0.4" ciStatus="green" />);
    const dot = container.querySelector(".pt-footer-ci");
    expect(dot).toHaveClass("pt-footer-ci-green");
  });

  it("renders the CI status dot with red class when ciStatus='red'", () => {
    const { container } = render(<Footer version="0.4" ciStatus="red" />);
    const dot = container.querySelector(".pt-footer-ci");
    expect(dot).toHaveClass("pt-footer-ci-red");
  });

  it("renders provided links in the right cell", () => {
    render(
      <Footer
        version="0.4"
        ciStatus="green"
        links={[
          { label: "github ↗", href: "https://github.com/cacheplane/pretable" },
          { label: "rss", href: "/rss.xml" },
        ]}
      />,
    );
    expect(screen.getByRole("link", { name: "github ↗" })).toHaveAttribute(
      "href",
      "https://github.com/cacheplane/pretable",
    );
    expect(screen.getByRole("link", { name: "rss" })).toHaveAttribute(
      "href",
      "/rss.xml",
    );
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
pnpm --filter @pretable/ui test
```

Expected: fail with "Cannot find module '../footer'".

- [ ] **Step 3: Write `packages/ui/src/footer.tsx`**

```tsx
export type CiStatus = "green" | "amber" | "red";

export interface FooterLink {
  label: string;
  href: string;
}

export interface FooterProps {
  version: string;
  ciStatus: CiStatus;
  links?: FooterLink[];
  year?: number;
  className?: string;
}

export function Footer({
  version,
  ciStatus,
  links = [],
  year = new Date().getFullYear(),
  className,
}: FooterProps) {
  const classes = ["pt-footer", className].filter(Boolean).join(" ");
  const dotClass = `pt-footer-ci pt-footer-ci-${ciStatus}`;
  return (
    <footer className={classes}>
      <div className="pt-footer-left">
        <span>
          <b>pretable</b> · v{version}
        </span>
        <span>© {year} · MIT</span>
        <span>
          ci:{" "}
          <span className={dotClass} aria-label={`ci ${ciStatus}`}>
            ●
          </span>{" "}
          {ciStatus}
        </span>
      </div>
      <div className="pt-footer-right">
        {links.map((link) => (
          <a key={link.label} href={link.href}>
            {link.label}
          </a>
        ))}
      </div>
    </footer>
  );
}
```

- [ ] **Step 4: Add the CSS rules to `packages/ui/src/components.css`**

Append:

```css
/* ------------------------------------------------------------- */
/* Footer — one-line monospace                                   */
/* ------------------------------------------------------------- */
.pt-footer {
  display: grid;
  grid-template-columns: 1fr auto;
  gap: 16px;
  padding: 22px 36px;
  background: var(--pt-cream);
  border-top: 1px solid var(--pt-cream-rule);
  font-family: var(--pt-font-mono);
  font-size: 11px;
  color: var(--pt-ink-dim);
}
.pt-footer-left {
  display: flex;
  gap: 18px;
}
.pt-footer-left b {
  color: var(--pt-ink);
  font-weight: 600;
}
.pt-footer-right {
  display: flex;
  gap: 18px;
}
.pt-footer-right a {
  color: var(--pt-ink-dim);
  text-decoration: none;
}
.pt-footer-right a:hover {
  color: var(--pt-ink);
}
.pt-footer-ci {
  display: inline-block;
  font-size: 12px;
  line-height: 1;
}
.pt-footer-ci-green {
  color: var(--pt-sev-ok);
}
.pt-footer-ci-amber {
  color: var(--pt-sev-warn);
}
.pt-footer-ci-red {
  color: var(--pt-sev-err);
}
```

- [ ] **Step 5: Export from the barrel**

Update `packages/ui/src/index.ts`:

```ts
export { Callout, type CalloutProps, type CalloutVariant } from "./callout";
export {
  CodeBlock,
  type CodeBlockProps,
  type CodeBlockTab,
} from "./code-block";
export {
  Footer,
  type CiStatus,
  type FooterLink,
  type FooterProps,
} from "./footer";
export { Nav, type NavCta, type NavPage, type NavProps } from "./nav";
export { Receipt, type ReceiptProps } from "./receipt";
```

- [ ] **Step 6: Run tests to verify they pass**

```bash
pnpm --filter @pretable/ui test
```

Expected: 19 passed (2 + 3 + 4 + 6 + 4).

- [ ] **Step 7: Commit**

```bash
git add packages/ui/src/footer.tsx packages/ui/src/__tests__/footer.test.tsx packages/ui/src/components.css packages/ui/src/index.ts
git commit -m "feat(ui): add Footer with CI status indicator"
```

---

## Task 8: Integration sanity check + PR prep

**Files:**

- No new files; verify build, lint, typecheck, format across the repo.

- [ ] **Step 1: Full build**

```bash
pnpm --filter @pretable/ui build
```

Expected:

- `dist/index.js` contains all five components bundled (ESM)
- `dist/index.d.ts` declaration file present with all named exports
- `dist/tokens.css` and `dist/components.css` present (copied by the tsup `onSuccess` hook)

Verify by listing the dist directory:

```bash
ls -la packages/ui/dist
```

Expected output includes: `index.js`, `index.d.ts`, `tokens.css`, `components.css`, plus possibly source maps. Both CSS files should be non-empty.

- [ ] **Step 2: Full test run**

```bash
pnpm --filter @pretable/ui test
```

Expected: 19 passed, 0 failed.

- [ ] **Step 3: Typecheck**

```bash
pnpm --filter @pretable/ui typecheck
```

Expected: clean, no errors.

- [ ] **Step 4: Lint**

```bash
pnpm --filter @pretable/ui lint
```

Expected: clean, no errors. If lint errors appear for unused imports in the test file, remove them. If the root ESLint config doesn't pick up `.tsx` in this package automatically, check `eslint.config.js` at the repo root to verify it globs `packages/*/src/**/*.tsx`.

- [ ] **Step 5: Cross-package regression — run the whole repo test/typecheck/lint to confirm nothing else broke**

```bash
pnpm test && pnpm typecheck && pnpm lint
```

Expected: all green. The new `@pretable/ui` package doesn't alter any other package, so this should be clean.

- [ ] **Step 6: Format check**

```bash
pnpm format
```

Expected: all files conform. If not:

```bash
pnpm format:write
git add -A
git commit -m "style: prettier formatting for @pretable/ui"
```

- [ ] **Step 7: Verify the package structure via a quick import test**

Create a temp file to simulate an app consuming the package — do NOT commit this. This step just confirms the public API works as documented.

```bash
cat > /tmp/pretable-ui-import-test.tsx <<'EOF'
import {
  Callout,
  CodeBlock,
  Footer,
  Nav,
  Receipt,
  type CiStatus,
  type NavProps,
} from "@pretable/ui";

// Type-level checks — no runtime.
const _ciStatusOk: CiStatus = "green";
const _navProps: NavProps = { active: "playground" };

void Callout;
void CodeBlock;
void Footer;
void Nav;
void Receipt;
void _ciStatusOk;
void _navProps;
EOF
pnpm tsc --noEmit --target es2022 --module esnext --moduleResolution bundler --jsx preserve --esModuleInterop --skipLibCheck /tmp/pretable-ui-import-test.tsx
rm /tmp/pretable-ui-import-test.tsx
```

Expected: no type errors. If the tsc step fails because of workspace resolution, skip it and rely on the `pnpm typecheck` from step 3.

- [ ] **Step 8: Push the branch and open a PR**

```bash
git log --oneline -8
```

Expected: 8 commits in sequence —

1. `chore(ui): scaffold @pretable/ui workspace package`
2. `feat(ui): add design tokens (palette, typography, layout)`
3. `feat(ui): add Receipt inline-tag component`
4. `feat(ui): add Callout component with default and warn variants`
5. `feat(ui): add CodeBlock with tabs and copy-to-clipboard`
6. `feat(ui): add Nav sticky-header with version pill and search trigger`
7. `feat(ui): add Footer with CI status indicator`
8. (optional) `style: prettier formatting for @pretable/ui`

Push and open the PR:

```bash
git push -u origin <current-branch-name>
gh pr create --title "feat(ui): add @pretable/ui shared design system package" --body "$(cat <<'EOF'
## Summary
- New workspace package `@pretable/ui` containing the shared design system for playground, bench, and docs.
- Ships design tokens (CSS custom properties), Fraunces font setup (via `@fontsource-variable/fraunces`), and five React components: `<Receipt>`, `<Callout>`, `<CodeBlock>`, `<Nav>`, `<Footer>`.
- No app migration in this PR — apps continue to use their existing styles. Playground (Plan B), bench (Plan C), and new docs app (Plan D) will consume this package in follow-up PRs.

## Design
Spec: `docs/superpowers/specs/2026-04-21-pretable-visual-system-design.md`
Implementation plan: `docs/superpowers/plans/2026-04-21-pretable-ui-package.md` (this plan)

## Test plan
- [x] 19 unit tests passing (`pnpm --filter @pretable/ui test`)
- [x] Typecheck clean (`pnpm --filter @pretable/ui typecheck`)
- [x] Lint clean
- [x] Full repo `pnpm test && pnpm typecheck && pnpm lint` green
- [x] Manual: `ls packages/ui/dist` shows `index.js`, `index.d.ts`, `tokens.css`, `components.css`

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 9: Monitor CI; merge on green**

Use `gh pr view --json statusCheckRollup --jq '.statusCheckRollup[] | {name, status, conclusion}'` or the Monitor tool with an until-loop to wait for all checks to complete.

When green:

```bash
gh pr merge --squash
```

---

## Self-Review Checklist

**1. Spec coverage:**

Spec §3 (Visual system) — tokens: ✅ Task 2.
Spec §3 typography stacks: ✅ Task 2 CSS vars.
Spec §3 contrast audit: ✅ All pairs implemented by tokens; no runtime check needed.
Spec §8 (`packages/ui`): ✅ Tasks 1–8.
Spec §8 component list: `<Nav>` ✅ T6, `<Footer>` ✅ T7, `<Receipt>` ✅ T3, `<CodeBlock>` ✅ T5, `<Callout>` ✅ T4. `<SearchModal>` deferred to Plan D per scope note at the top.
Spec §10 styling approach: ✅ locked to vanilla CSS with tsup `onSuccess` copy (Task 1, Step 5).
Spec §10 font hosting: ✅ locked to `@fontsource-variable/fraunces` (Task 1 dependency).

**2. Placeholder scan:** no TBDs, no "implement later," no "similar to Task N." Every step shows actual code.

**3. Type consistency:**

- `NavPage` consistent across Nav (T6) and NavProps type (T6).
- `CiStatus` defined in Footer (T7), referenced in FooterProps only.
- `CalloutVariant` defined in Callout (T4), "default" | "warn" in both type and prop.
- `CodeBlockTab` shape `{ label: string; content: ReactNode }` matches test expectations (T5).
- `pt-*` CSS class prefix consistent across all components.

**4. Commit-message style:** matches existing repo history (`feat(ui)`, `chore(ui)`, `style:`) as seen in `git log --oneline`.

---

## Follow-up plans (after Plan A ships)

- **Plan B — `apps/playground` redesign** — consume `@pretable/ui`, restructure to the spec §5 layout, preserve the grid-layout regression fix from PR #4.
- **Plan C — `apps/bench` redesign + adversarial comparison UI** — consume `@pretable/ui`, build 4-column comparison, permalink round-tripping, CI history chart reading from `status/runsets/*.json`.
- **Plan D — `apps/docs` new app** — scaffold new Vite app, Mintlify-layout chrome consuming `@pretable/ui`, MDX content, Fuse.js search, `<SearchModal>` component added to `@pretable/ui`, API-reference split-pane, Getting Started populated.

Plans B, C, D can run in parallel once A is merged.
