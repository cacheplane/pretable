import type { ReactNode } from "react";

export interface ReceiptProps {
  children: ReactNode;
  className?: string;
}

export function Receipt({ children, className }: ReceiptProps) {
  const classes = ["pt-receipt", className].filter(Boolean).join(" ");
  return <span className={classes}>{children}</span>;
}
