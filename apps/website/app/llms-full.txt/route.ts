import path from "node:path";

import { buildLlmsFullTxt } from "./build";

const ROOT = path.join(process.cwd(), "content/docs");

export const dynamic = "force-static";
export const revalidate = 3600;

export async function GET() {
  const text = await buildLlmsFullTxt(ROOT);
  return new Response(text, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "public, s-maxage=3600",
    },
  });
}
