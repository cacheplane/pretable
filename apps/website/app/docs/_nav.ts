export interface DocsNavItem {
  title: string;
  href: string;
}

export interface DocsNavSection {
  title: string;
  items: DocsNavItem[];
}

export const docsNav: DocsNavSection[] = [
  {
    title: "Getting Started",
    items: [
      { title: "Install + first grid", href: "/docs/getting-started" },
      { title: "Concepts", href: "/docs/getting-started/concepts" },
    ],
  },
  {
    title: "Grid",
    items: [
      { title: "Overview", href: "/docs/grid" },
      {
        title: "<Pretable> component",
        href: "/docs/grid/pretable-component",
      },
      {
        title: "<PretableSurface> component",
        href: "/docs/grid/pretable-surface",
      },
      { title: "Selection", href: "/docs/grid/selection" },
      { title: "Keyboard", href: "/docs/grid/keyboard" },
      { title: "Clipboard", href: "/docs/grid/clipboard" },
      { title: "Editing", href: "/docs/grid/editing" },
      { title: "Column layout", href: "/docs/grid/column-layout" },
      { title: "Cell renderers", href: "/docs/grid/cell-renderers" },
      {
        title: "Custom rendering",
        href: "/docs/grid/custom-rendering",
      },
      { title: "Density helpers", href: "/docs/grid/density-helpers" },
      { title: "API reference", href: "/docs/grid/api-reference" },
    ],
  },
  {
    title: "Headless engine",
    items: [
      { title: "Overview", href: "/docs/headless" },
      { title: "First headless grid", href: "/docs/headless/getting-started" },
      { title: "Snapshot & subscribe", href: "/docs/headless/state-model" },
      { title: "Actions", href: "/docs/headless/mutations" },
      { title: "API reference", href: "/docs/headless/api-reference" },
    ],
  },
  {
    title: "Streaming",
    items: [
      { title: "Overview", href: "/docs/streaming" },
      { title: "Element streams", href: "/docs/streaming/element-streams" },
      { title: "Partial streams", href: "/docs/streaming/partial-streams" },
      { title: "Parsers", href: "/docs/streaming/parsers" },
      { title: "API reference", href: "/docs/streaming/api-reference" },
    ],
  },
  {
    title: "Theming",
    items: [
      { title: "Overview", href: "/docs/theming" },
      { title: "Pick a theme", href: "/docs/theming/pick-a-theme" },
      { title: "Override tokens", href: "/docs/theming/override-tokens" },
      { title: "Light / dark", href: "/docs/theming/light-dark" },
      { title: "Density", href: "/docs/theming/density" },
      { title: "Custom themes", href: "/docs/theming/custom-themes" },
      {
        title: "Tailwind + CSS-in-JS",
        href: "/docs/theming/tailwind-css-in-js",
      },
      {
        title: "Cascade & overrides",
        href: "/docs/theming/cascade-and-overrides",
      },
      { title: "Token reference", href: "/docs/theming/token-reference" },
    ],
  },
];
