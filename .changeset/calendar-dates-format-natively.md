---
"@pretable/core": minor
"@pretable/react": minor
---

**Breaking:** Make date columns strict RFC 3339 full-date values and add native,
locale-aware date formatting. Applications must project Date, epoch, date-time,
or localized values to `YYYY-MM-DD | null` to retain built-in date processing.
