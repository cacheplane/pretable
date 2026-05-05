export function DocsBreadcrumb({
  group,
  title,
}: {
  group: string;
  title: string;
}) {
  return (
    <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-text-dim">
      {group} <span aria-hidden="true">›</span>{" "}
      <span className="text-text-secondary normal-case tracking-normal">
        {title}
      </span>
    </p>
  );
}
