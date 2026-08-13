import { describe, expect, it } from "vitest";

import { loadExample } from "../examples/registry";
import {
  exampleRegistry,
  type ExampleId,
} from "../examples/registry.generated";

describe("loadExample", () => {
  it.each(Object.keys(exampleRegistry) as ExampleId[])(
    "loads %s with every declared file present and non-empty",
    async (id) => {
      const example = await loadExample(id);
      expect(example.id).toBe(id);
      expect(example.meta).toBe(exampleRegistry[id].meta);
      expect(example.hasDemo).toBe(exampleRegistry[id].hasDemo);
      expect(example.files.map((f) => f.path)).toEqual([
        ...exampleRegistry[id].meta.files,
      ]);
      for (const f of example.files) {
        expect(f.source.length).toBeGreaterThan(0);
      }
    },
  );

  it("resolves genuinely loaded content, not just non-empty source", async () => {
    const example = await loadExample("grouping-panel");
    const [grid] = example.files;
    // The export name is load-bearing — demo.tsx imports it by name — so it
    // can't drift silently the way user-visible copy can.
    expect(grid.source).toContain("export function GroupingPanelGrid");
  });

  it("memoises: two calls with the same id share one promise", () => {
    const first = loadExample("grouping-panel");
    const second = loadExample("grouping-panel");
    expect(second).toBe(first);
  });

  it("rejects an unregistered id instead of throwing synchronously", async () => {
    await expect(loadExample("nope" as ExampleId)).rejects.toThrow(
      /Unknown example id/,
    );
  });

  it("rejects an inherited Object.prototype key rather than crashing on undefined meta", async () => {
    // exampleRegistry["constructor"] resolves via the prototype chain and is
    // truthy, so a `!entry` check alone would pass this straight through to
    // `entry.meta.files` and blow up with an unattributable TypeError.
    await expect(loadExample("constructor" as ExampleId)).rejects.toThrow(
      /Unknown example id/,
    );
  });
});
