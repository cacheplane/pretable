import { CopyPageButton } from "./CopyPageButton";
import { DocsBreadcrumb } from "./DocsBreadcrumb";

export function DocsPageHeader({
  group,
  title,
  description,
  path,
}: {
  group: string;
  title: string;
  description: string;
  path: string;
}) {
  return (
    <header className="mb-8">
      <DocsBreadcrumb group={group} title={title} />
      <h1 className="mt-3 font-display text-[36px] leading-[1.05] tracking-[-0.025em] text-text-primary">
        {title}
      </h1>
      <div className="mt-3 flex items-start justify-between gap-4">
        <p className="font-display text-[15px] leading-[1.55] text-text-secondary">
          {description}
        </p>
        <CopyPageButton path={path} />
      </div>
    </header>
  );
}
