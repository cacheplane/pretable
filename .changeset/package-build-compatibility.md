---
"@pretable/core": minor
"@pretable/react": minor
"@pretable/stream-adapter": minor
"@pretable/ui": minor
---

Modernize the public package build architecture and support both React 18 and
React 19. All public packages retain first-class ESM and CommonJS package-name
imports, with an explicit ES2018 syntax and runtime API compatibility contract.
Generated filenames and private `dist` paths are not stable or supported; use
the documented package root and exported subpaths.
