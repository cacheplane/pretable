import { codeToHtml } from "shiki";

interface CodeBlockProps {
  code: string;
  lang?: string;
}

// Server-side shiki highlight. Renders pre-highlighted HTML inside the React
// tree — no client JS for highlighting. The wrapping <div> applies the cool-slate
// container styling so MDX <pre> blocks and the landing's <CodeExample> share
// one visual treatment.
//
// CONSTRAINT: do NOT add request-context APIs (cookies(), headers(), draftMode())
// here. CodeExample evaluates this once at module load (top-level await on a
// static snippet) — request context is unavailable there. If a future caller
// needs request-aware highlighting, fork into a separate component.
export async function CodeBlock({ code, lang = "tsx" }: CodeBlockProps) {
  const html = await codeToHtml(code.trimEnd(), {
    lang,
    theme: "github-light",
  });
  return (
    <div
      className="overflow-x-auto rounded-[6px] border border-grid-rule bg-grid-bg p-4 font-mono text-[13px] leading-[1.6] [&_pre]:m-0 [&_pre]:bg-transparent [&_code]:bg-transparent"
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
