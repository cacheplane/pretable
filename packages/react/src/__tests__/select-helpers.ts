/**
 * Drivers for `PretableSelect` in jsdom. Not a suite: vitest's default
 * `include` collects `*.test.*` / `*.spec.*` only, and this file is neither,
 * so it is imported, never run.
 */
import { fireEvent } from "@testing-library/react";

/**
 * Drive a PretableSelect the way a pointer does: open it, click the option.
 * Replaces `fireEvent.change(select, { target: { value } })`, which a
 * button[role=combobox] cannot honour. The list is portalled to body.
 */
export function chooseOption(trigger: HTMLElement, value: string): void {
  fireEvent.click(trigger);
  const option = document.querySelector<HTMLElement>(
    `[data-pretable-listbox] [data-pretable-option][data-value="${value}"]`,
  );
  if (!option) {
    throw new Error(`chooseOption: no option "${value}" in the open list`);
  }
  fireEvent.click(option);
}

/** The option values and labels a PretableSelect offers, read by opening it. */
export function readOptions(trigger: HTMLElement): {
  values: string[];
  labels: string[];
} {
  fireEvent.click(trigger);
  const items = Array.from(
    document.querySelectorAll<HTMLElement>(
      "[data-pretable-listbox] [data-pretable-option]",
    ),
  );
  const result = {
    values: items.map((el) => el.getAttribute("data-value") ?? ""),
    labels: items.map((el) => el.textContent ?? ""),
  };
  fireEvent.keyDown(trigger, { key: "Escape" });
  return result;
}

/** The committed value, from the attribute the component writes for exactly this. */
export function selectValue(trigger: HTMLElement): string | null {
  return trigger.getAttribute("data-pretable-value");
}
