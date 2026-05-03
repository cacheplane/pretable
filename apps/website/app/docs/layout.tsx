import { NavBar } from "../components/NavBar";
import { DocsSidebar } from "../components/DocsSidebar";

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
        <article className="max-w-[68ch] [&_h1]:font-display [&_h1]:text-[36px] [&_h1]:leading-[1.05] [&_h1]:tracking-[-0.025em] [&_h1]:text-text-primary [&_h2]:mt-12 [&_h2]:font-display [&_h2]:text-[24px] [&_h2]:tracking-[-0.02em] [&_h2]:text-text-primary [&_h3]:mt-8 [&_h3]:font-display [&_h3]:text-[18px] [&_h3]:text-text-primary [&_p]:mt-4 [&_p]:text-[15px] [&_p]:leading-[1.65] [&_p]:text-text-secondary [&_a]:text-accent [&_a]:underline-offset-2 hover:[&_a]:underline [&_code]:font-mono [&_code]:text-[13px] [&_code]:text-text-primary [&_ol]:mt-4 [&_ol]:list-decimal [&_ol]:pl-6 [&_ul]:mt-4 [&_ul]:list-disc [&_ul]:pl-6 [&_li]:mt-1 [&_li]:text-[15px] [&_li]:leading-[1.65] [&_li]:text-text-secondary">
          {children}
        </article>
      </div>
    </>
  );
}
