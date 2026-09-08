---
"@pretable/react": minor
---

Keep Select highlights attached to option values when options reorder, and
choose an enabled fallback when an active option is removed or disabled.
Empty rosters close the Select; all-disabled lists have no active option.
Typeahead starts fresh each time the list opens.

Rich Select option labels now require a plain `textValue` for typeahead.
String and number labels continue to infer their text. This tightens
`PretableSelectOption` from an interface to a union: add `textValue` to rich
labels and replace interfaces extending the old type with type intersections.

Preserve callback-ref cleanup in Select, Checkbox and TextInput, including
ref replacement and StrictMode attachment cycles. Object refs and callbacks
without cleanup still receive their usual null detach.
