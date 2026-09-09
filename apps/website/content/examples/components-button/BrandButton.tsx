"use client";

import { forwardRef } from "react";
import type { PretableButtonProps } from "@pretable/react";

/**
 * Replaces the kit's labelled actions. Preserve native props and the ref so
 * the grid's handlers, accessible names, anchoring and focus still work.
 */
export const BrandButton = forwardRef<HTMLButtonElement, PretableButtonProps>(
  function BrandButton({ site, variant, className, ...props }, ref) {
    // One place treated differently: the reset is destructive, so it gets the
    // app's danger styling. Everything else is the brand default.
    const tone = site === "tool-reset" ? "danger" : (variant ?? "ghost");
    return (
      <button
        {...props}
        ref={ref}
        type="button"
        className={["brand-button", `brand-button--${tone}`, className]
          .filter(Boolean)
          .join(" ")}
      />
    );
  },
);
