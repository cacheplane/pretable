import {
  PretableOverlayProvider,
  type PretableOverlayProviderProps,
} from "@pretable/react";
import type { Equal, Expect } from "../shared/assert";
export type OverlayContainer = Expect<
  Equal<PretableOverlayProviderProps["container"], HTMLElement | null>
>;
const container = document.createElement("div");
<PretableOverlayProvider container={container}>
  <div />
</PretableOverlayProvider>;
<PretableOverlayProvider container={null}>
  <div />
</PretableOverlayProvider>;
// @ts-expect-error — null waits, but omission must not silently select body
<PretableOverlayProvider>
  <div />
</PretableOverlayProvider>;
// @ts-expect-error — the portal host is an element, not a selector
<PretableOverlayProvider container="#host">
  <div />
</PretableOverlayProvider>;
