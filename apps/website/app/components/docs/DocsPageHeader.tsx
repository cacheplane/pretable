import { DocsBreadcrumb } from "./DocsBreadcrumb";

export function DocsPageHeader({
  group,
  title,
  description,
}: {
  group: string;
  title: string;
  description: string;
}) {
  return (
    <header className="mb-8">
      <DocsBreadcrumb group={group} title={title} />
      <h1 className="mt-3 font-display text-[36px] leading-[1.05] tracking-[-0.025em] text-text-primary">
        {title}
      </h1>
      <p className="mt-3 font-display text-[15px] leading-[1.55] text-text-secondary">
        {description}
      </p>
    </header>
  );
}
