import type { ReactNode } from "react";

export function Frame({
  caption,
  children,
}: {
  caption?: string;
  children: ReactNode;
}) {
  return (
    <figure className="my-6 rounded-md border border-rule bg-bg-card/40 p-3">
      <div className="overflow-hidden rounded-[4px]">{children}</div>
      {caption && (
        <figcaption className="mt-2 text-center font-mono text-[11px] text-text-dim">
          {caption}
        </figcaption>
      )}
    </figure>
  );
}
