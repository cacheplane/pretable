import { describe, expect, it } from "vitest";

import type { LoadedExample } from "../examples/define";
import { exampleCatalogLine, toMarkdown } from "../examples/serialize";
import { exampleCanonicalUrl, examplePath } from "../examples/urls";

const example: LoadedExample = {
  id: "grouping-panel",
  meta: {
    title: "Drag-to-group panel",
    description: "Enable the grouping panel.",
    files: ["Grid.tsx", "columns.ts"],
  },
  hasDemo: true,
  files: [
    {
      path: "Grid.tsx",
      lang: "tsx",
      source: "export function Grid() {}",
      html: "<pre/>",
      focusLines: [],
    },
    {
      path: "columns.ts",
      lang: "ts",
      source: "export const columns = [];",
      html: "<pre/>",
      focusLines: [],
    },
  ],
};

describe("example urls", () => {
  it("uses the public .md convention", () => {
    expect(examplePath("grouping-panel")).toBe("/examples/grouping-panel.md");
    expect(exampleCanonicalUrl("grouping-panel")).toBe(
      "https://pretable.ai/examples/grouping-panel.md",
    );
  });
});

describe("toMarkdown", () => {
  it("emits title, description, a derived Source line, and path-labelled fences", () => {
    expect(toMarkdown(example)).toBe(
      [
        "### Example: Drag-to-group panel",
        "",
        "Enable the grouping panel.",
        "",
        "Source: https://pretable.ai/examples/grouping-panel.md",
        "",
        "```tsx Grid.tsx",
        "export function Grid() {}",
        "```",
        "",
        "```ts columns.ts",
        "export const columns = [];",
        "```",
        "",
      ].join("\n"),
    );
  });

  it("uses an explicit canonicalUrl instead of the derived one, at the same position", () => {
    expect(toMarkdown(example, { canonicalUrl: "https://x.test/a.md" })).toBe(
      [
        "### Example: Drag-to-group panel",
        "",
        "Enable the grouping panel.",
        "",
        "Source: https://x.test/a.md",
        "",
        "```tsx Grid.tsx",
        "export function Grid() {}",
        "```",
        "",
        "```ts columns.ts",
        "export const columns = [];",
        "```",
        "",
      ].join("\n"),
    );
  });

  it("emits the heading at a caller-chosen level, defaulting to 3", () => {
    expect(toMarkdown(example).split("\n")[0]).toBe(
      "### Example: Drag-to-group panel",
    );
    expect(toMarkdown(example, { headingLevel: 1 }).split("\n")[0]).toBe(
      "# Example: Drag-to-group panel",
    );
    expect(toMarkdown(example, { headingLevel: 4 }).split("\n")[0]).toBe(
      "#### Example: Drag-to-group panel",
    );
  });

  it("widens the fence for a JSDoc comment quoting a fenced block (over-widening, not corruption)", () => {
    const withJsDocFence: LoadedExample = {
      ...example,
      files: [
        {
          path: "docs.ts",
          lang: "ts",
          source: [
            "/**",
            " * Example:",
            " * ```ts",
            " * const x = 1;",
            " * ```",
            " */",
          ].join("\n"),
          html: "<pre/>",
          focusLines: [],
        },
      ],
    };
    const out = toMarkdown(withJsDocFence);
    expect(out).toContain("````ts docs.ts");
    // The inner triple-backtick run must survive untouched, and the fence
    // that closes the file block must be the widened one, not a bare ```.
    expect(out).toContain(" * ```ts\n * const x = 1;\n * ```\n");
    const fenceLines = out.split("\n").filter((line) => /^`+/.test(line));
    expect(fenceLines).toEqual(["````ts docs.ts", "````"]);
  });

  it("widens the fence for a column-0 triple-backtick run — the real corruption case", () => {
    const withHeredocFence: LoadedExample = {
      ...example,
      files: [
        {
          path: "readme.sh",
          lang: "bash",
          source: ["cat <<'EOF'", "```", "example markdown", "```", "EOF"].join(
            "\n",
          ),
          html: "<pre/>",
          focusLines: [],
        },
      ],
    };
    // A bare ``` wrapper fence would be closed early by the heredoc's own
    // ``` line, which sits at column 0 like a real closer, truncating
    // everything the agent reads after it — so the wrapper must widen to
    // four backticks while the heredoc's own ``` lines pass through
    // untouched. Byte-exact so the wrapper fence can't be confused with the
    // content's own backtick lines.
    expect(toMarkdown(withHeredocFence)).toBe(
      [
        "### Example: Drag-to-group panel",
        "",
        "Enable the grouping panel.",
        "",
        "Source: https://pretable.ai/examples/grouping-panel.md",
        "",
        "````bash readme.sh",
        "cat <<'EOF'",
        "```",
        "example markdown",
        "```",
        "EOF",
        "````",
        "",
      ].join("\n"),
    );
  });
});

describe("exampleCatalogLine", () => {
  it("formats a single llms.txt catalog entry", () => {
    expect(exampleCatalogLine(example.id, example.meta)).toBe(
      "- [Drag-to-group panel](/examples/grouping-panel.md): Enable the grouping panel.",
    );
  });
});
