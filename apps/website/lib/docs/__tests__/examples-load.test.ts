import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { loadExampleFiles } from "../examples/load";

let dir: string;

beforeAll(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), "pretable-example-"));
  await fs.writeFile(
    path.join(dir, "Grid.tsx"),
    [
      'import { PretableSurface } from "@pretable/react";',
      "",
      "export function Grid() {",
      "  return <PretableSurface groupPanel={{ enabled: true }} />; // [!focus]",
      "}",
      "",
      "",
    ].join("\n"),
    "utf8",
  );
  await fs.writeFile(
    path.join(dir, "columns.ts"),
    "export const columns = [];\n",
    "utf8",
  );
  await fs.writeFile(
    path.join(dir, "broken.ts"),
    "// [!focus:start]\nexport const a = 1;\n",
    "utf8",
  );
  await fs.writeFile(
    path.join(dir, "trailing-focus.ts"),
    [
      "export const a = 1;",
      "// [!focus:start]",
      "export const b = 2;",
      "",
      "",
      "// [!focus:end]",
      "",
      "",
    ].join("\n"),
    "utf8",
  );
  await fs.mkdir(path.join(dir, "a-directory.ts"));
});

afterAll(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

describe("loadExampleFiles", () => {
  it("returns files in declared order with inferred languages", async () => {
    const files = await loadExampleFiles(dir, {
      title: "T",
      description: "D",
      files: ["Grid.tsx", "columns.ts"],
    });
    expect(files.map((f) => f.path)).toEqual(["Grid.tsx", "columns.ts"]);
    expect(files.map((f) => f.lang)).toEqual(["tsx", "ts"]);
  });

  it("strips focus markers and trims trailing blank lines from source", async () => {
    const [grid] = await loadExampleFiles(dir, {
      title: "T",
      description: "D",
      files: ["Grid.tsx"],
    });
    expect(grid.source).not.toMatch(/\[!focus/);
    expect(grid.source.endsWith("}")).toBe(true);
    expect(grid.focusLines).toEqual([4]);
  });

  it("marks focused lines in the highlighted html", async () => {
    const [grid] = await loadExampleFiles(dir, {
      title: "T",
      description: "D",
      files: ["Grid.tsx"],
    });
    expect(grid.html).not.toMatch(/\[!focus/);

    const lines = grid.html.split("\n");
    expect(lines.filter((l) => l.includes("line-focus"))).toHaveLength(1);
    expect(lines[3]).toContain("line-focus"); // 0-based; source line 4
    expect(lines[3]).toContain("PretableSurface");
  });

  it("marks no lines when a file has no focus markers", async () => {
    const [columns] = await loadExampleFiles(dir, {
      title: "T",
      description: "D",
      files: ["columns.ts"],
    });
    expect(columns.focusLines).toEqual([]);
    expect(columns.html).not.toContain("line-focus");
  });

  it("names the file in the error when it is missing from disk", async () => {
    await expect(
      loadExampleFiles(dir, {
        title: "T",
        description: "D",
        files: ["nope.ts"],
      }),
    ).rejects.toThrow(/not found on disk.*nope\.ts/);
  });

  it("reports the real cause, not 'not found', when the declared file is a directory", async () => {
    await expect(
      loadExampleFiles(dir, {
        title: "T",
        description: "D",
        files: ["a-directory.ts"],
      }),
    ).rejects.toThrow(/could not be read \(EISDIR\).*a-directory\.ts/);
  });

  it("names the file in the error when its markers are unbalanced", async () => {
    await expect(
      loadExampleFiles(dir, {
        title: "T",
        description: "D",
        files: ["broken.ts"],
      }),
    ).rejects.toThrow(/broken\.ts/);
  });

  it("drops focus lines that fall past the end after trailing blank lines are trimmed", async () => {
    const [file] = await loadExampleFiles(dir, {
      title: "T",
      description: "D",
      files: ["trailing-focus.ts"],
    });
    const lineCount = file.source.split("\n").length;
    for (const line of file.focusLines) {
      expect(line).toBeLessThanOrEqual(lineCount);
    }
    // The region covers "export const b = 2;" plus two blank lines before
    // [!focus:end]; the blank lines are trimmed away by trimEnd(), so only
    // the surviving line should remain focused.
    expect(file.focusLines).toEqual([2]);
  });
});
