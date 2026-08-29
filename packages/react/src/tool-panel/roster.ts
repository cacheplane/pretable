/**
 * The roster resolver — the pure half of composable sections (SP4). Lives
 * beside the section machinery, imports no React values, so validation and
 * ordering are testable without a DOM (the repo's established split).
 */
import type {
  PretableToolPanelSection,
  ToolPanelSectionDescriptor,
  ToolPanelSectionId,
} from "./sections";

/**
 * One `toolPanel.sections` entry: a built-in referenced by id, or a custom
 * section as a descriptor. The array element type is API even if this alias
 * stays internal — the config field may inline the union instead.
 */
export type ToolPanelRosterEntry =
  ToolPanelSectionId | PretableToolPanelSection;

/**
 * Resolve the `toolPanel.sections` roster to the descriptor array the shell
 * renders. Absent → the built-ins, AS THE SAME ARRAY (identity matters: the
 * descriptor memo's stability pin watches it). Present → the complete rail
 * in the roster's order — built-ins resolved to their real descriptors,
 * custom sections passed through by reference.
 *
 * Validation THROWS (spec decision 4): a duplicate id, an empty id, a
 * whitespace id, an unknown built-in reference, and a custom descriptor
 * reusing a built-in id are programming errors present from the first
 * render — unlike data-dependent faults they cannot lurk, and warn-and-drop
 * would make a silently missing tab the harder bug.
 */
export function resolveToolPanelRoster(
  entries: readonly ToolPanelRosterEntry[] | undefined,
  builtins: readonly ToolPanelSectionDescriptor[],
): readonly ToolPanelSectionDescriptor[] {
  if (entries === undefined) return builtins;
  const builtinById = new Map(builtins.map((s) => [s.id, s]));
  const seen = new Set<string>();
  return entries.map((entry) => {
    const isReference = typeof entry === "string";
    let resolved: ToolPanelSectionDescriptor;
    if (isReference) {
      const builtin = builtinById.get(entry);
      if (builtin === undefined) {
        throw new Error(
          `[pretable] toolPanel.sections: "${entry}" is not a built-in section id.`,
        );
      }
      resolved = builtin;
    } else {
      // Structurally identical since the internal id widened to `string`;
      // the custom descriptor passes through by reference on purpose
      // (its `render` is the consumer's own closure).
      resolved = entry;
      if (entry.id.length === 0) {
        throw new Error(
          "[pretable] toolPanel.sections: a section id may not be empty.",
        );
      }
      if (/\s/.test(entry.id)) {
        throw new Error(
          `[pretable] toolPanel.sections: section id "${entry.id}" contains whitespace, which DOM ids forbid.`,
        );
      }
      if (builtinById.has(entry.id)) {
        throw new Error(
          `[pretable] toolPanel.sections: "${entry.id}" is a built-in section id, and replacing a built-in section is not supported — reference it as the string "${entry.id}", or pick another id.`,
        );
      }
    }
    if (seen.has(resolved.id)) {
      throw new Error(
        `[pretable] toolPanel.sections: duplicate section id "${resolved.id}".`,
      );
    }
    seen.add(resolved.id);
    return resolved;
  });
}
