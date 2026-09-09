---
"@pretable/react": minor
"@pretable/ui": minor
---

Finish editor adoption of the component kit. Text, number, enum and date
fields resolve TextInput; multiline fields resolve the new native Textarea
slot. Number steppers and date month buttons resolve IconButton. Preserve
forwarded refs, native props, handlers and ARIA/data hooks in replacements.

Correct enum identity and clearing. Explicit choices retain their canonical
value even with duplicate labels; ambiguous typed labels/values require a
choice. Empty queries can commit null. Custom parsers receive canonical value
text for an explicit choice and query text for typed input.

Composition keys retain native behavior. Shift+Tab commits left and Shift+Enter
up, including when controlled rows acknowledge a save later; cancelled or
replaced sessions ignore stale acknowledgements. Multiline plain Enter remains a newline. Calendar navigation now browses
without changing the draft: Enter accepts an intentionally navigated date,
while Tab/blur commit the typed/current value. Date inputs expose a complete
grid-popup combobox contract.

Preserve editor error/focus/pending styling after kit adoption, prevent error
messages from squeezing fields sideways, and complete disabled and forced-color
calendar/action states. Upgrade React and UI together for the new site hooks.
