import type { LoadedExample } from "./define";

export interface ToMarkdownOptions {
  /** When set, adds a `Source:` line so a fetched example is traceable. */
  canonicalUrl?: string;
}

/**
 * Length of a fence long enough that it cannot be closed early by any
 * backtick run already present in `content`. Real source can legitimately
 * contain a triple-backtick run — a template literal or a JSDoc comment
 * quoting markdown — which would otherwise terminate the fence early and
 * corrupt everything the agent reads after it.
 */
function fenceFor(content: string): string {
  const runs = content.match(/`+/g) ?? [];
  const longest = runs.reduce((max, run) => Math.max(max, run.length), 0);
  return "`".repeat(Math.max(3, longest + 1));
}

/**
 * The single markdown representation of an example. Every agent-facing surface
 * — inline expansion, the per-example route, copy-for-agent, llms-full.txt —
 * goes through here, so what an agent reads cannot drift from what a reader
 * sees on the page.
 */
export function toMarkdown(
  example: LoadedExample,
  opts: ToMarkdownOptions = {},
): string {
  const lines: string[] = [
    `### Example: ${example.meta.title}`,
    "",
    example.meta.description,
  ];
  if (opts.canonicalUrl) {
    lines.push("", `Source: ${opts.canonicalUrl}`);
  }
  for (const file of example.files) {
    const fence = fenceFor(file.source);
    lines.push("", `${fence}${file.lang} ${file.path}`, file.source, fence);
  }
  lines.push("");
  return lines.join("\n");
}
