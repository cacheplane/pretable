---
"@pretable/react": minor
---

Add `defaultSaveFile`, `toCsvBlob` and `buildExportFileName` — the delivery half
of CSV export.

Blob + `<a download>`, chosen over `showSaveFilePicker` for one decisive reason:
`<a download>` has no user-activation requirement, so it still works after an
`await`, while the picker is transient-activation-gated and throws
`SecurityError` once any async work has happened. Chrome's own guidance is to
open the picker _before_ doing the work, which would make the user name a file
before knowing whether the export succeeded.

`buildExportFileName` is pure and sanitizes for the union of all three
platforms, because everything the browser would otherwise do to a name is lossy,
silent, and differs by OS — Chromium replaces `:` with `_` on _every_ platform,
strips leading dots, and diverges between Windows and POSIX on trailing dots.

An incomplete export is marked in the **filename** (`-PARTIAL`). The signal
cannot go in the file: RFC 4180 has no comment syntax, so a marker row is a data
row. A filename travels with the artifact when it is emailed onward and costs
the bytes nothing.
