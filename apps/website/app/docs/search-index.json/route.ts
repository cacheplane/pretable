import path from "node:path";

import { buildSearchIndex } from "../../../lib/docs/search-index";

const ROOT = path.join(process.cwd(), "content/docs");

export const dynamic = "force-static";

export async function GET() {
  const idx = await buildSearchIndex(ROOT);
  return Response.json(idx);
}
