import { describe, expect, it, vi } from "vitest";

import type { LoadedExample } from "../examples/define";
import { expandExamples, type Loader } from "../examples/expand";
import { loadExample } from "../examples/registry";

const fakeExample: LoadedExample = {
  id: "grouping-panel",
  meta: {
    title: "Drag-to-group panel",
    description: "Enable the grouping panel.",
    files: ["Grid.tsx"],
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
  ],
};

function fakeLoader(): Loader {
  return vi.fn(async () => fakeExample);
}

describe("expandExamples", () => {
  it("returns a document with no <Example> tags byte-identical, without calling load", async () => {
    const raw = "# Title\n\nSome prose with no examples in it.\n";
    const load = fakeLoader();
    const result = await expandExamples(raw, load);
    expect(result).toBe(raw);
    expect(load).not.toHaveBeenCalled();
  });

  it("replaces a tag with the serialized bundle, preserving surrounding prose", async () => {
    const raw = 'before text\n\n<Example id="grouping-panel" />\n\nafter text';
    const load = fakeLoader();
    const result = await expandExamples(raw, load);

    expect(result).toContain("before text");
    expect(result).toContain("after text");
    expect(result).toContain("### Example: Drag-to-group panel");
    expect(result).toContain("```tsx Grid.tsx");
    expect(result).toContain("export function Grid() {}");
    expect(result).not.toContain("<Example");
  });

  it("expands every occurrence, including a tag whose props are in a different order", async () => {
    const raw = [
      '<Example id="grouping-panel" />',
      "middle",
      '<Example initial="code" id="grouping-panel" />',
    ].join("\n");
    const load = fakeLoader();
    const result = await expandExamples(raw, load);

    expect(load).toHaveBeenCalledTimes(2);
    expect(result).not.toContain("<Example");
    const occurrences = result.match(/### Example: Drag-to-group panel/g);
    expect(occurrences).toHaveLength(2);
    expect(result).toContain("middle");
  });

  it("rejects an unknown example id, naming it", async () => {
    const raw = '<Example id="does-not-exist" />';
    const load = fakeLoader();
    await expect(expandExamples(raw, load)).rejects.toThrow(/does-not-exist/);
    expect(load).not.toHaveBeenCalled();
  });

  it("rejects a tag with no id attribute, naming the tag", async () => {
    const raw = '<Example initial="code" />';
    const load = fakeLoader();
    await expect(expandExamples(raw, load)).rejects.toThrow(
      /<Example initial="code" \/>/,
    );
    expect(load).not.toHaveBeenCalled();
  });
});

describe("expandExamples against real content", () => {
  it("expands content/docs/grid/grouping.mdx so the example's real code is present", async () => {
    const fs = await import("node:fs/promises");
    const path = await import("node:path");
    const filePath = path.join(process.cwd(), "content/docs/grid/grouping.mdx");
    const raw = await fs.readFile(filePath, "utf8");
    const body = raw.replace(/^---\n[\s\S]*?\n---\n?/, "");

    const result = await expandExamples(body, loadExample);

    expect(result).toContain("GroupingPanelGrid.tsx");
    expect(result).not.toContain("<Example");
  });
});
