import { forwardRef } from "react";
import type {
  PretableIconButtonProps,
  PretableTextareaProps,
  PretableTextInputProps,
} from "@pretable/react";

// Keep these component identities stable: defining them inside the grid
// would remount the active editor each time the parent renders.
export const AppTextInput = forwardRef<
  HTMLInputElement,
  PretableTextInputProps
>(function AppTextInput({ site, className, ...props }, ref) {
  return (
    <input
      {...props}
      ref={ref}
      className={["app-editor-input", className].filter(Boolean).join(" ")}
      data-pretable-text-input=""
      data-pretable-site={site}
    />
  );
});

export const AppTextarea = forwardRef<
  HTMLTextAreaElement,
  PretableTextareaProps
>(function AppTextarea({ site, className, ...props }, ref) {
  return (
    <textarea
      {...props}
      ref={ref}
      className={["app-editor-textarea", className].filter(Boolean).join(" ")}
      data-pretable-textarea=""
      data-pretable-site={site}
    />
  );
});

export const AppIconButton = forwardRef<
  HTMLButtonElement,
  PretableIconButtonProps
>(function AppIconButton({ site, className, ...props }, ref) {
  return (
    <button
      {...props}
      ref={ref}
      type="button"
      className={["app-editor-icon-button", className]
        .filter(Boolean)
        .join(" ")}
      data-pretable-icon-button=""
      data-pretable-site={site}
    />
  );
});

// The spread preserves value, native handlers (including composition),
// disabled, ARIA attributes, data attributes, children, and inline styles.
// The kit attributes above keep @pretable/ui's layout and state styling.
