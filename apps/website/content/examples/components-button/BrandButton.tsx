"use client";

import { forwardRef } from "react";
import type { PretableButtonProps } from "@pretable/react";

/**
 * The app's own button, standing in for every Button the grid renders. It
 * receives exactly what pretable's does — `site` included — and forwards its
 * ref, which is the one thing the grid asks of a replacement: menus anchor on
 * the node, and focus returns to it.
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
