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
      { title: "Token reference", href: "/docs/theming/token-reference" },
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
        title: "Custom rendering",
        href: "/docs/grid/custom-rendering",
      },
      { title: "Density helpers", href: "/docs/grid/density-helpers" },
      { title: "API reference", href: "/docs/grid/api-reference" },
    ],
  },
];
