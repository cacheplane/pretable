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
    `[data-pretable-listbox] [data-pretable-option][data-pretable-option-value="${value}"]`,
  );
  if (!option) {
    throw new Error(`chooseOption: no option "${value}" in the open list`);
  }
  fireEvent.click(option);
}

/**
 * The option values and labels a PretableSelect offers, read by opening it and
 * closing it again with an outside press — not Escape, which would return
 * focus to the trigger and make a read-only helper move the caller's focus.
 */
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
    values: items.map(
      (el) => el.getAttribute("data-pretable-option-value") ?? "",
    ),
    labels: items.map((el) => el.textContent ?? ""),
  };
  fireEvent.pointerDown(document.body);
  return result;
}

/** The committed value, from the attribute the component writes for exactly this. */
export function selectValue(trigger: HTMLElement): string | null {
  return trigger.getAttribute("data-pretable-value");
}

/**
 * What the trigger DISPLAYS, from the label span's text — as opposed to
 * `selectValue`, which reads what it HOLDS. The trigger renders the matching
 * option's label when the value names one, and the bare value when it does
 * not, so comparing this against the list's own label for that value is how
 * a caller catches a value that has silently fallen out of the option set.
 */
export function selectLabel(trigger: HTMLElement): string | null {
  return (
    trigger.querySelector("[data-pretable-select-label]")?.textContent ?? null
  );
}
