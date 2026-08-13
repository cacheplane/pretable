import { NextResponse, type NextRequest } from "next/server";

export const config = { matcher: ["/docs/:path*", "/examples/:path*"] };

export function proxy(req: NextRequest) {
  const url = req.nextUrl.clone();
  if (!url.pathname.endsWith(".md")) return;
  // Each branch strips its own public prefix (leading slash and trailing
  // slash both counted) and replaces it with the matching internal route's
  // prefix, keeping the remainder's own leading slash intact:
  //   "/docs/".length === 5      -> "/docs/grid/x.md"      -> "/docs-md/grid/x"
  //   "/examples/".length === 9  -> "/examples/foo.md"      -> "/examples-md/foo"
  if (url.pathname.startsWith("/docs/")) {
    url.pathname = "/docs-md" + url.pathname.slice(5).replace(/\.md$/, "");
    return NextResponse.rewrite(url);
  }
  if (url.pathname.startsWith("/examples/")) {
    url.pathname = "/examples-md" + url.pathname.slice(9).replace(/\.md$/, "");
    return NextResponse.rewrite(url);
  }
}
