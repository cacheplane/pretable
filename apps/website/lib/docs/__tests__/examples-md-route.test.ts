import { describe, expect, it } from "vitest";

import {
  GET,
  generateStaticParams,
} from "../../../app/examples-md/[slug]/route";
import { exampleRegistry } from "../examples/registry.generated";

describe("GET /examples-md/[slug]", () => {
  it("serves a registered example as a level-1 markdown document", async () => {
    const res = await GET(
      new Request("https://x.test/examples-md/grouping-panel"),
      {
        params: Promise.resolve({ slug: "grouping-panel" }),
      },
    );
    expect(res.headers.get("content-type")).toMatch(/text\/markdown/);
    const text = await res.text();
    expect(text.startsWith("# Example: ")).toBe(true);
    expect(text).not.toContain("### Example: ");
    // The example's real source, not a stand-in — proves the route reads
    // through the loader rather than returning a canned body.
    expect(text).toContain("export function GroupingPanelGrid");
  });

  it("404s for an unregistered slug instead of returning 200", async () => {
    let error: unknown;
    try {
      await GET(new Request("https://x.test/examples-md/does-not-exist"), {
        params: Promise.resolve({ slug: "does-not-exist" }),
      });
    } catch (e) {
      error = e;
    }
    // Pinned to notFound()'s own digest, not just "something was thrown" —
    // loadExample's "Unknown example id" rejection would also satisfy a bare
    // rejects.toThrow(), which would make this pass even if the route's
    // isExampleId guard were bypassed (e.g. `slug as ExampleId`) and 404
    // handling fell through to the loader's rejection instead.
    expect((error as { digest?: string } | undefined)?.digest).toBe(
      "NEXT_HTTP_ERROR_FALLBACK;404",
    );
  });
});

describe("generateStaticParams", () => {
  it("returns exactly the registered slugs", () => {
    const params = generateStaticParams();
    expect(params.map((p) => p.slug).sort()).toEqual(
      Object.keys(exampleRegistry).sort(),
    );
  });
});
