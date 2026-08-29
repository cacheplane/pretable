---
"@pretable/react": minor
---

Consumer-composable tool-panel sections: `toolPanel.sections` states the
complete rail.

`PretableToolPanelConfig` gains `sections` — an ordered roster mixing built-in
section ids (`"columns"`, `"filters"`, `"grouping"`) with custom sections
authored as the new public `PretableToolPanelSection` descriptor (`id`, `icon`,
`label`, `render`). One array subsumes appending a pane, hiding a built-in,
reordering the tabs, and interleaving; absent, the rail is the three built-ins
exactly as before, and `[]` turns the panel off. The active-section fields
(`defaultActiveSection`, `activeSection`, `onActiveSectionChange`) widen to the
new `PretableToolPanelSectionId` (`ToolPanelSectionId | (string & {})`) so a
custom id is nameable everywhere a built-in's is, without losing autocomplete.

An invalid roster — a duplicate, empty, or whitespace id, an unknown built-in
reference, or a custom descriptor reusing a built-in id — throws at render
with a `[pretable] toolPanel.sections:` message naming the id and the rule.
An `activeSection` naming an id the roster does not carry renders the rail
alone without throwing. Custom panes inherit the shell's a11y contract
(tabpanel semantics, Escape-to-rail, one rail Tab stop); a section that needs
the grid reaches it through the existing `onGridReady` handle.
