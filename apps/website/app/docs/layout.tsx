import { NavBar } from "../components/NavBar";
import { DocsSidebar } from "../components/DocsSidebar";

// MDX prose styling. Tables especially need explicit borders/padding because
// MDX emits raw <table>/<thead>/<th>/<td> with no classes — without these
// rules they fall back to browser-default rendering (no borders, no padding).
const PROSE_CLASSES = [
  "max-w-[68ch]",
  // Headings
  "[&_h1]:font-display [&_h1]:text-[36px] [&_h1]:leading-[1.05] [&_h1]:tracking-[-0.025em] [&_h1]:text-text-primary",
  "[&_h2]:mt-12 [&_h2]:font-display [&_h2]:text-[24px] [&_h2]:tracking-[-0.02em] [&_h2]:text-text-primary",
  "[&_h3]:mt-8 [&_h3]:font-display [&_h3]:text-[18px] [&_h3]:text-text-primary",
  // Body
  "[&_p]:mt-4 [&_p]:text-[15px] [&_p]:leading-[1.65] [&_p]:text-text-secondary",
  "[&_a]:text-accent [&_a]:underline-offset-2 hover:[&_a]:underline",
  "[&_code]:font-mono [&_code]:text-[13px] [&_code]:text-text-primary",
  // Lists
  "[&_ol]:mt-4 [&_ol]:list-decimal [&_ol]:pl-6",
  "[&_ul]:mt-4 [&_ul]:list-disc [&_ul]:pl-6",
  "[&_li]:mt-1 [&_li]:text-[15px] [&_li]:leading-[1.65] [&_li]:text-text-secondary",
  // Tables — display:block + overflow lets wide reference tables scroll
  // horizontally inside the 68ch column without breaking the page layout.
  "[&_table]:mt-6 [&_table]:block [&_table]:max-w-full [&_table]:overflow-x-auto [&_table]:font-mono [&_table]:text-[13px] [&_table]:border-collapse",
  "[&_thead]:bg-bg-card [&_thead]:border-b [&_thead]:border-rule",
  "[&_th]:px-3 [&_th]:py-2 [&_th]:text-left [&_th]:font-medium [&_th]:text-text-primary [&_th]:whitespace-nowrap",
  "[&_td]:px-3 [&_td]:py-2 [&_td]:border-b [&_td]:border-rule-soft [&_td]:align-top [&_td]:text-text-secondary",
  "[&_tr:last-child_td]:border-b-0",
].join(" ");

export default function DocsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <>
      <NavBar mode="site" />
      <div className="mx-auto grid max-w-[1240px] grid-cols-1 gap-8 px-7 py-12 md:grid-cols-[240px_minmax(0,1fr)] md:px-10 md:py-16">
        <DocsSidebar />
        <article className={PROSE_CLASSES}>{children}</article>
      </div>
    </>
  );
}
