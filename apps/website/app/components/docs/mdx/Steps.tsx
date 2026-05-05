import { Children, isValidElement, type ReactNode } from "react";

export function Steps({ children }: { children: ReactNode }) {
  const items = Children.toArray(children).filter(isValidElement);
  return (
    <ol className="my-6 flex flex-col gap-4 border-l border-rule pl-6">
      {items.map((c, i) => (
        <li key={i} className="relative">
          <span
            aria-hidden="true"
            className="absolute -left-[34px] top-0 flex h-6 w-6 items-center justify-center rounded-full border border-rule bg-bg-card font-mono text-[11px] text-text-secondary"
          >
            {i + 1}
          </span>
          {c}
        </li>
      ))}
    </ol>
  );
}

export function Step({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <div>
      <h4 className="font-display text-[15px] text-text-primary">{title}</h4>
      <div className="mt-1 text-[14px] text-text-secondary">{children}</div>
    </div>
  );
}
