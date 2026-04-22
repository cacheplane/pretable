# @pretable/ui

Shared design-system primitives for the pretable apps (playground, bench, docs).

## Usage

In your app's main entry:

```tsx
import "@fontsource-variable/fraunces";
import "@pretable/ui/tokens.css";
import "@pretable/ui/components.css";

import { Nav, Footer, Receipt, Callout, CodeBlock } from "@pretable/ui";
```

All theming is done via CSS custom properties defined in `tokens.css`. Override any variable at a more specific scope to retheme.

## Design spec

See [`docs/superpowers/specs/2026-04-21-pretable-visual-system-design.md`](../../docs/superpowers/specs/2026-04-21-pretable-visual-system-design.md) in this repo.
