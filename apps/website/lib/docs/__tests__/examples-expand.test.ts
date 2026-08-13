import { describe, expect, it, vi } from "vitest";

import type { LoadedExample } from "../examples/define";
import {
  expandDocsBody,
  expandExamples,
  type Loader,
} from "../examples/expand";
import { loadExample } from "../examples/registry";
import { toMarkdown } from "../examples/serialize";

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

const fakeExampleB: LoadedExample = {
  id: "streaming-chat-grid",
  meta: {
    title: "Streaming chat grid",
    description: "Streams rows into the grid as they arrive.",
    files: ["ChatGrid.tsx"],
  },
  hasDemo: true,
  files: [
    {
      path: "ChatGrid.tsx",
      lang: "tsx",
      source: "export function ChatGrid() {}",
      html: "<pre/>",
      focusLines: [],
    },
  ],
};

function fakeLoader(): Loader {
  return vi.fn(async () => fakeExample);
}

// Distinct from `fakeLoader`: returns a *different* example per id, so a
// test using this can tell whether the splice loop paired each match with
// its own replacement or just happened to work because every id resolved to
// the same content.
function twoIdLoader(): Loader {
  return vi.fn(async (id) =>
    id === fakeExampleB.id ? fakeExampleB : fakeExample,
  );
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

  it("splices the heading in at the start of its own line, not glued to the end of prose (exact output, not just toContain)", async () => {
    const raw = 'before text\n\n<Example id="grouping-panel" />\n\nafter text';
    const load = fakeLoader();
    const result = await expandExamples(raw, load);

    expect(result).toBe(
      `before text\n\n${toMarkdown(fakeExample)}\n\nafter text`,
    );
  });

  it("pairs each match with its own replacement by position, not a shared one (two different ids)", async () => {
    const raw = [
      '<Example id="grouping-panel" />',
      "middle prose",
      '<Example id="streaming-chat-grid" />',
    ].join("\n");
    const load = twoIdLoader();
    const result = await expandExamples(raw, load);

    const groupingIdx = result.indexOf("### Example: Drag-to-group panel");
    const middleIdx = result.indexOf("middle prose");
    const streamingIdx = result.indexOf("### Example: Streaming chat grid");

    expect(groupingIdx).toBeGreaterThanOrEqual(0);
    expect(middleIdx).toBeGreaterThanOrEqual(0);
    expect(streamingIdx).toBeGreaterThanOrEqual(0);
    // The grouping-panel heading sits before "middle prose", which sits
    // before the streaming-chat-grid heading — each id's content stayed
    // next to the prose it was adjacent to in the source, rather than the
    // two replacements swapping places.
    expect(groupingIdx).toBeLessThan(middleIdx);
    expect(middleIdx).toBeLessThan(streamingIdx);
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

  it("rejects an unknown example id, naming it and listing the registered ids and the fix (registry.ts's unknownIdMessage, reused rather than a thinner ad hoc message)", async () => {
    const raw = '<Example id="does-not-exist" />';
    const load = fakeLoader();
    await expect(expandExamples(raw, load)).rejects.toThrow(
      /Unknown example id: "does-not-exist"\. Registered ids: .*pnpm examples:gen/s,
    );
    expect(load).not.toHaveBeenCalled();
  });

  it("folds the source label into an unknown-id error, so the failing document doesn't need to be grepped for", async () => {
    const raw = '<Example id="does-not-exist" />';
    const load = fakeLoader();
    await expect(
      expandExamples(raw, load, "content/docs/grid/grouping.mdx"),
    ).rejects.toThrow(/content\/docs\/grid\/grouping\.mdx/);
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

describe("expandDocsBody", () => {
  it("strips frontmatter and expands examples in one call", async () => {
    const raw = [
      "---",
      "title: T",
      "---",
      'before\n\n<Example id="grouping-panel" />\n\nafter',
    ].join("\n");
    const load = fakeLoader();
    const result = await expandDocsBody(raw, "T", load);

    expect(result).not.toContain("---");
    expect(result).not.toContain("<Example");
    expect(result).toContain("before");
    expect(result).toContain("after");
    expect(result).toContain("### Example: Drag-to-group panel");
  });
});

describe("expandExamples against real content", () => {
  it("expands content/docs/grid/grouping.mdx so the example's real code is present", async () => {
    const fs = await import("node:fs/promises");
    const path = await import("node:path");
    const filePath = path.join(process.cwd(), "content/docs/grid/grouping.mdx");
    const raw = await fs.readFile(filePath, "utf8");

    const result = await expandDocsBody(raw, filePath, loadExample);

    expect(result).toContain("GroupingPanelGrid.tsx");
    expect(result).not.toContain("<Example");
  });
});
