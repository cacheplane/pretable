---
"@pretable/react": patch
---

Keyboard-opened header popovers now scroll their anchor into view before opening, so `Alt+↓` (filter) and `Shift+F10` (column menu) work when the page has scrolled the grid header out of sight instead of silently swallowing the key.
