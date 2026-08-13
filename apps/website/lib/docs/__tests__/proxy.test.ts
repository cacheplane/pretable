import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";

import { proxy } from "../../../proxy";

function pathAfter(req: NextRequest): string | undefined {
  const res = proxy(req);
  return res?.headers.get("x-middleware-rewrite")
    ? new URL(res.headers.get("x-middleware-rewrite")!).pathname
    : undefined;
}

describe("proxy", () => {
  it("rewrites /examples/<slug>.md to /examples-md/<slug>", () => {
    const req = new NextRequest("https://x.test/examples/grouping-panel.md");
    expect(pathAfter(req)).toBe("/examples-md/grouping-panel");
  });

  it("still rewrites /docs/<slug>.md to /docs-md/<slug>", () => {
    const req = new NextRequest("https://x.test/docs/grid/grouping.md");
    expect(pathAfter(req)).toBe("/docs-md/grid/grouping");
  });

  it("leaves a non-.md path under /examples/ alone", () => {
    const req = new NextRequest("https://x.test/examples/grouping-panel");
    expect(proxy(req)).toBeUndefined();
  });

  it("leaves a non-.md path under /docs/ alone", () => {
    const req = new NextRequest("https://x.test/docs/grid/grouping");
    expect(proxy(req)).toBeUndefined();
  });

  it("preserves extra segments of a nested /examples/ path rather than mangling them (the route's [slug] is single-segment, so this 404s downstream, but the rewrite itself must not corrupt or drop the remainder)", () => {
    const req = new NextRequest("https://x.test/examples/a/b.md");
    expect(pathAfter(req)).toBe("/examples-md/a/b");
  });
});
