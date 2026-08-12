import { describe, expect, it } from "vitest";

import type { LoadedExample } from "../examples/define";
import { toMarkdown } from "../examples/serialize";
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
  it("emits title, description, and path-labelled fences", () => {
    expect(toMarkdown(example)).toBe(
      [
        "### Example: Drag-to-group panel",
        "",
        "Enable the grouping panel.",
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

  it("includes a Source line when a canonical url is given", () => {
    expect(
      toMarkdown(example, { canonicalUrl: "https://x.test/a.md" }),
    ).toContain("\nSource: https://x.test/a.md\n");
  });

  it("widens the fence when source contains a triple-backtick run", () => {
    const withFence: LoadedExample = {
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
    const out = toMarkdown(withFence);
    expect(out).toContain("````ts docs.ts");
    // The inner triple-backtick run must survive untouched, and the fence
    // that closes the file block must be the widened one, not a bare ```.
    expect(out).toContain(" * ```ts\n * const x = 1;\n * ```\n");
    const fenceLines = out.split("\n").filter((line) => /^`+/.test(line));
    expect(fenceLines).toEqual(["````ts docs.ts", "````"]);
  });
});
