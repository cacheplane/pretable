import { NextResponse, type NextRequest } from "next/server";

export const config = { matcher: ["/docs/:path*", "/examples/:path*"] };

export function proxy(req: NextRequest) {
  const url = req.nextUrl.clone();
  if (!url.pathname.endsWith(".md")) return;
  if (url.pathname.startsWith("/docs/")) {
    url.pathname = url.pathname
      .replace(/^\/docs\//, "/docs-md/")
      .replace(/\.md$/, "");
    return NextResponse.rewrite(url);
  }
  if (url.pathname.startsWith("/examples/")) {
    url.pathname = url.pathname
      .replace(/^\/examples\//, "/examples-md/")
      .replace(/\.md$/, "");
    return NextResponse.rewrite(url);
  }
}
