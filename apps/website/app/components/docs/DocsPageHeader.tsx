export function DocsPageHeader({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  return (
    <header className="mb-8">
      <h1 className="font-display text-[36px] leading-[1.05] tracking-[-0.025em] text-text-primary">
        {title}
      </h1>
      <p className="mt-2 font-display text-[15px] leading-[1.55] text-text-secondary">
        {description}
      </p>
    </header>
  );
}
