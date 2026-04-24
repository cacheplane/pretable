import type { Phase1Entry, Phase2Entry } from "./types";

export function parseJsonl<T>(text: string): T[] {
  const results: T[] = [];
  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (line.length === 0) continue;
    try {
      results.push(JSON.parse(line) as T);
    } catch (err) {
      throw new Error(
        `Failed to parse JSONL line ${i + 1}: ${(err as Error).message}`,
      );
    }
  }
  return results;
}

export async function loadPhase1(url: string): Promise<Phase1Entry[]> {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Failed to fetch ${url}: ${res.status} ${res.statusText}`);
  }
  return parseJsonl<Phase1Entry>(await res.text());
}

export async function loadPhase2(url: string): Promise<Phase2Entry[]> {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Failed to fetch ${url}: ${res.status} ${res.statusText}`);
  }
  return parseJsonl<Phase2Entry>(await res.text());
}
