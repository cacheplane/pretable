import type { ReactNode } from "react";

export type CalloutVariant = "default" | "warn";

export interface CalloutProps {
  children: ReactNode;
  tag?: string;
  variant?: CalloutVariant;
  className?: string;
}

export function Callout({
  children,
  tag,
  variant = "default",
  className,
}: CalloutProps) {
  const classes = [
    "pt-callout",
    variant === "warn" ? "pt-callout-warn" : null,
    className,
  ]
    .filter(Boolean)
    .join(" ");
  return (
    <div className={classes}>
      {tag ? <span className="pt-callout-tag">{tag}</span> : null}
      <span className="pt-callout-body">{children}</span>
    </div>
  );
}
