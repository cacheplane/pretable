/**
 * The tool panel's section contract — the seam between the shell (rail +
 * pane, this directory) and the sections that live inside it (columns,
 * filters, grouping today; SP4 opened the roster to consumer-supplied
 * sections).
 *
 * The DESCRIPTOR stays internal on purpose: consumers author sections
 * through the public {@link PretableToolPanelSection} shape on the
 * surface's config, and the surface converts. The shell treats descriptors
 * as data it does not understand — which is exactly what made opening the
 * roster a type change rather than a shell change.
 */
import type { ComponentType, ReactNode } from "react";

/**
 * The built-in section ids — a closed union by design, even now that the
 * roster is open (SP4): the docs guard's prose enumeration and the
 * roster-parsing discriminator (a string roster entry IS a built-in
 * reference) both depend on it staying closed. The open vocabulary is
 * {@link PretableToolPanelSectionId}.
 *
 * @public
 */
export type ToolPanelSectionId = "columns" | "filters" | "grouping";

/**
 * A section id nameable in the tool panel's active-section fields: a
 * built-in literal (kept as literals so editors autocomplete them) or any
 * consumer-supplied custom id. The `(string & {})` intersection is the
 * established idiom for an open-but-suggested union.
 *
 * See `docs/superpowers/specs/2026-08-29-tool-panel-sp4-composable-sections.md`,
 * decision 3.
 *
 * @public
 */
export type PretableToolPanelSectionId = ToolPanelSectionId | (string & {});

/**
 * A consumer-supplied tool-panel section: one rail tab and the pane content
 * it opens. Supplied through `toolPanel.sections`, interleaved freely with
 * built-in ids.
 *
 * See `docs/superpowers/specs/2026-08-29-tool-panel-sp4-composable-sections.md`,
 * decision 2.
 *
 * @public
 */
export interface PretableToolPanelSection {
  /** Non-empty and free of whitespace — the id is interpolated into DOM
   * ids (the tab's id, the pane's `aria-labelledby`), where whitespace is
   * forbidden. Must not collide with a built-in id ("columns", "filters",
   * "grouping"): replacing a built-in section is not supported. Carried
   * verbatim on `data-pretable-section`. */
  readonly id: string;
  /** Rail tab icon. */
  readonly icon: ComponentType<{ className?: string }>;
  /** Rail tooltip and the tab's accessible name. A plain string, not a
   * message key: a custom section is consumer-owned UI, and the consumer
   * localizes it where they localize the rest of their app. The messages
   * layer stays the built-ins'. */
  readonly label: string;
  /** Pane content. Takes no arguments: a section that needs the grid holds
   * the handle via `onGridReady`; everything else it closes over. */
  readonly render: () => ReactNode;
}

/**
 * Ids here are `string`, not the built-in union: the shell always treated
 * ids as opaque data (assuming a closed union at runtime was never
 * allowed), and since SP4 the type says so — custom descriptors flow
 * through the same seam as built-ins.
 */
export interface ToolPanelSectionDescriptor {
  readonly id: string;
  readonly icon: ComponentType<{ className?: string }>;
  readonly label: string;
  /** Props are baked in by the surface when it constructs descriptors —
   * the shell renders sections without knowing what they need. (For a
   * consumer descriptor, "baked in" is the consumer's own closure.) */
  readonly render: () => ReactNode;
}
