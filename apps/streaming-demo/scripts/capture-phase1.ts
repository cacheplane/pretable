/**
 * One-time capture script: calls openai.responses.create() with streaming
 * enabled, records every SSE event with a relative timestamp, writes to
 * recordings/phase1.jsonl. Requires OPENAI_API_KEY env var.
 *
 * Run: pnpm --filter @pretable/app-streaming-demo capture
 */
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { performance } from "node:perf_hooks";

import OpenAI from "openai";

const ROOT = join(import.meta.dirname ?? __dirname, "..");
const OUT = join(ROOT, "src", "recordings", "phase1.jsonl");
const MODEL = process.env.OPENAI_MODEL ?? "gpt-5";

if (!process.env.OPENAI_API_KEY) {
  console.error("OPENAI_API_KEY is required");
  process.exit(1);
}

const PROMPT = `Generate exactly 2500 fictional stock tickers as a single JSON array of objects, output on a single line with no surrounding prose. Fields per object:
- symbol: 4-5 uppercase letters
- name: a realistic company name
- last: number between 1 and 5000, two decimals
- change_pct: number between -10 and 10, two decimals
- volume: integer between 100000 and 100000000
- sector: one of Technology, Healthcare, Financials, Consumer, Energy, Industrials, Materials, Utilities, RealEstate, Communication
- last_update: string HH:MM:SS representing a plausible US market hours time

Output the JSON array only, no prose, no backticks.`;

const openai = new OpenAI();

async function main() {
  console.log(`[capture-phase1] model=${MODEL}`);
  const start = performance.now();
  const lines: string[] = [];

  const stream = await openai.responses.create({
    model: MODEL,
    input: PROMPT,
    stream: true,
  });

  for await (const event of stream) {
    const t = Number(((performance.now() - start) / 1000).toFixed(3));
    if (event.type === "response.output_text.delta") {
      lines.push(
        JSON.stringify({
          t,
          type: "response.output_text.delta",
          delta: event.delta,
        }),
      );
    } else if (
      event.type === "response.created" ||
      event.type === "response.output_text.done" ||
      event.type === "response.completed"
    ) {
      lines.push(JSON.stringify({ t, type: event.type }));
    }
  }

  writeFileSync(OUT, lines.join("\n") + "\n");

  const duration = (performance.now() - start) / 1000;
  const deltas = lines.filter((l) => l.includes("output_text.delta")).length;
  console.log(
    `[capture-phase1] captured ${lines.length} events (${deltas} deltas) in ${duration.toFixed(1)}s`,
  );
}

main().catch((err) => {
  console.error("[capture-phase1] failed:", err);
  process.exit(1);
});
