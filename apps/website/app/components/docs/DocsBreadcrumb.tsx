import { docsNav } from "../../docs/_nav";

export interface DocsBreadcrumbItem {
  name: string;
  path: string;
}

export function getDocsBreadcrumbItems({
  path,
  title,
}: {
  path: string;
  title: string;
}): readonly DocsBreadcrumbItem[] {
  const section = docsNav.find((candidate) =>
    candidate.items.some((item) => item.href === path),
  );
  if (!section) {
    throw new Error(`Docs navigation has no breadcrumb section for ${path}`);
  }

  return [
    { name: section.title, path: section.items[0].href },
    { name: title, path },
  ];
}

export function DocsBreadcrumb({
  path,
  title,
}: {
  path: string;
  title: string;
}) {
  const [group, page] = getDocsBreadcrumbItems({ path, title });

  return (
    <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-text-dim">
      {group.name} <span aria-hidden="true">›</span>{" "}
      <span className="text-text-secondary normal-case tracking-normal">
        {page.name}
      </span>
    </p>
  );
}
