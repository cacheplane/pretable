import { NextResponse, type NextRequest } from "next/server";

export const config = { matcher: "/docs/:path*" };

export function middleware(req: NextRequest) {
  const url = req.nextUrl.clone();
  if (url.pathname.endsWith(".md")) {
    url.pathname = "/docs-md" + url.pathname.slice(5).replace(/\.md$/, "");
    return NextResponse.rewrite(url);
  }
}
