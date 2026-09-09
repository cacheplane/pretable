---
"@pretable/react": minor
"@pretable/ui": minor
---

Add PretableOverlayProvider for an explicit popup container. Place the grid
and portal host in the same CSS scope to preserve custom tokens, direction
and live theme changes while escaping the grid's clipping viewport. The
provider does not copy trigger styles. Without a provider, popups still use
body; a provider with a null target defers popup content until attachment.

Track nested portal ownership for outside presses. Sibling Selects close one
another, clicks inside nested lists preserve the parent dialog, and trigger
toggles work without hiding outside pointer events.
Keep Select and header popups anchored when live scope or layout changes move
their trigger, including delayed portal attachment.

Rename the listbox active marker from data-active to data-pretable-active.
Update custom selectors and upgrade the React/UI packages together. Complete
disabled option styles and forced-colors active-option/checkbox state pairs,
including selected-disabled options and checked/mixed disabled checkboxes.
