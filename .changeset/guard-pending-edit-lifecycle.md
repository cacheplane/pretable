---
"@pretable/react": patch
"@pretable/core": patch
---

Prevent cell edits from committing before permission resolves or dispatching
duplicate validation/save operations. Recover from permission, parsing,
validation, and save callback failures without leaving a pending editor stuck,
and ignore stale results after an edit session is replaced or cancelled.

Draft writes during checking, validating, and saving are now ignored, including
writes from custom editors. This intentionally removes the previous behavior
where a draft write could unlock a pending edit. Enum label normalization waits
for edit permission, and pending editor commit keys do not submit another write.
