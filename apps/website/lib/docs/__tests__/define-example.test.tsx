import { describe, expect, it } from "vitest";

import { defineExample } from "../define-example";

describe("defineExample", () => {
  it("returns the input narrowed to ExampleDef", () => {
    const def = defineExample({
      title: "X",
      Demo: <div>demo</div>,
      files: [{ path: "page.tsx", lang: "tsx", source: "const x = 1;" }],
    });
    expect(def.title).toBe("X");
    expect(def.files[0].path).toBe("page.tsx");
  });
  it("accepts pre-highlighted htmlSource", () => {
    const def = defineExample({
      title: "X",
      Demo: <div />,
      files: [
        {
          path: "a.ts",
          lang: "ts",
          source: "const a = 1;",
          htmlSource: "<pre><code>const a = 1;</code></pre>",
        },
      ],
    });
    expect(def.files[0].htmlSource).toContain("<pre>");
  });
});
