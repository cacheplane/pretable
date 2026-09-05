# Components SP1: the contract, and Button / IconButton

Date: 2026-09-04
Status: approved, ready for planning (variant names and the `site` prop
corrected during planning — see the plan's header)

## Purpose

pretable renders 40 `<button>` elements, 15 `<input>`s, 9 native `<select>`s and
a `<textarea>` with no shared component behind them. The selects wear native
chrome inside an otherwise designed surface; the buttons carry their looks as
per-site CSS. The program this spec opens replaces all of them with a
pre-built, accessible, styleable component kit that a consumer can also replace
per component type with their own.

This is the first of four sub-projects. It settles the contract every later
component inherits — where components live, how a consumer replaces one, how a
consumer styles one, what a component guarantees — and proves it with the
simplest component, against the grid's own push-buttons.

The kit is the product; replacement is the escape hatch. Design effort goes to
what the components look like and how they behave, and the override contract
follows what those components need.

## Decisions (each confirmed with the user)

1. **Pretable UI kit first.** A designed, accessible set most consumers ship
   as-is. Not primarily an integration seam, not a standalone library.
2. **End state: every control in the grid rebuilt on the kit.** Reached in
   four sub-projects, by component type:
   - SP1 (this spec): the contract + Button / IconButton.
   - SP2: Select, and the Listbox/Popover primitive it needs — the nine native
     selects.
   - SP3: TextInput / Textarea / Checkbox — the remaining inputs.
   - SP4: docs, theming page, accessibility sweep.
3. **Override shape: one slot per component type, props carry the site.**
   `components={{ Button: MyButton }}` replaces every button in the grid. Ours
   passes a `site` among the props, so a consumer who wants one place treated
   differently branches on it in their own component. No per-site public
   names.
4. **Styling: attributes + tokens, `className`/`style` passthrough.** The house
   pattern `PretableBadge` already follows. No `classNames` map, no unstyled
   build, no variant-as-styling-channel.
5. **SP1's Button covers plain push-buttons only.** Menu items, checkboxes,
   the tab, the twisty and header cells are roles that happen to use the
   `<button>` element; each waits for its own component.
6. **Plumbing: context, resolved once at the surface.** pretable portals its
   popovers into `document.body`; context crosses portals, props do not, and
   the popovers are where overrides matter most.
7. **Excel theme is light-only, and stays so for now.** Recorded here because
   it came out of the same conversation; not SP1 work.

## Placement

Components live in `packages/react/src/components/` — the two push-buttons
share `button.tsx`, since they share a props vocabulary — and are
exported from `@pretable/react`'s public API alongside `PretableBadge`,
`PretableDelta`, `PretableEntity` and `PretableStatus`. Same package, same
api-extractor gate, same `Pretable*` naming. No new package: a second build,
report and version to keep in step buys nothing while the grid is the only
consumer.

## The components

Two components, one contract.

```ts
export type PretableButtonVariant = "ghost" | "link";

/** The twelve sites SP1 migrates — each name is the site's existing attribute suffix. */
export type PretableBuiltInButtonSite =
  | "filter-add"
  | "add-group"
  | "expand-all"
  | "collapse-all"
  | "filter-clear"
  | "tool-reset"
  | "filter-funnel"
  | "column-menu-button"
  | "tool-row-menu-button"
  | "chip-remove"
  | "filter-row-remove"
  | "tool-group-remove";

/** Built-in site names, open to strings the grid does not know yet. */
export type PretableButtonSite = PretableBuiltInButtonSite | (string & {});

export interface PretableButtonProps extends Omit<
  ButtonHTMLAttributes<HTMLButtonElement>,
  "type"
> {
  /** The two labelled looks the grid uses today. Default: "ghost". */
  variant?: PretableButtonVariant;
  /**
   * Where in the grid this button is. Lands as data-pretable-site. Named
   * `site`, not `role`: `role` is the ARIA attribute on every button, and a
   * replacement that spread `role="filter-clear"` onto a <button> would emit
   * invalid ARIA.
   */
  site?: PretableButtonSite;
}

export interface PretableIconButtonProps extends Omit<
  ButtonHTMLAttributes<HTMLButtonElement>,
  "type" | "aria-label"
> {
  /** REQUIRED. An icon-only button has no other accessible name. */
  "aria-label": string;
  site?: PretableButtonSite;
}

export const PretableButton: ForwardRefExoticComponent<
  PretableButtonProps & RefAttributes<HTMLButtonElement>
>;
export const PretableIconButton: ForwardRefExoticComponent<
  PretableIconButtonProps & RefAttributes<HTMLButtonElement>
>;
```

Guarantees, for both:

- Renders `<button type="button">`, always. Every grid button is `type="button"`
  today, and a stray submit inside a consumer's `<form>` is a real bug class,
  so `type` is not a prop.
- `className` and `style` pass through and **merge** with ours; they never
  replace the component's own attributes.
- `disabled` gets the standard treatment established in #573:
  `--pretable-text-dim`, `cursor: default`, and every hover rule guarded with
  `:not(:disabled)`. Under forced colours, `GrayText`.
- The DOM carries `data-pretable-button` or `data-pretable-icon-button`,
  `data-pretable-variant` (Button only), and `data-pretable-site` when a site
  is given. This is the styling channel: those attributes and the
  `--pretable-*` tokens, nothing new.
- `forwardRef` reaches the `<button>` node. The tool panel already needs
  button nodes for focus return; a component that hid them would break it.
- Focus ring is the shared `outline: 2px solid var(--pretable-focus-ring)` at
  `-2px`, as every ring in `grid.css` is.

IconButton makes the accessible name a **type error** to omit. That converts a
WCAG failure the grid can currently ship into a compile failure, and is the one
place SP1 makes something impossible rather than merely wrong.

Not props: `size`, `tone`, `loading`, `icon` slots. None of the twelve sites
needs them; each is added when a site does.

## The override contract

```ts
export interface PretableComponents {
  Button?: ComponentType<PretableButtonProps>;
  IconButton?: ComponentType<PretableIconButtonProps>;
}

// on PretableSurfaceProps (and through it, PretableProps):
components?: PretableComponents;
```

- A replacement receives **exactly what ours receives** — the same props,
  `site` included — so a consumer's component is a drop-in, and can branch on
  `site` to treat one place differently.
- `PretableButtonSite` is the union of built-in names plus `(string & {})`,
  the same shape as `PretableToolPanelSectionId`: autocomplete for ours, no
  type error when the grid gains a site.
- The **props** are stable public API. The **set of sites** is documented but
  additive: a new grid button may introduce a new site without a major bump.
- pretable never depends on a replacement's DOM shape. Anything the grid needs
  from a button node — focus return, popover anchoring — goes through the
  `ref`, which a replacement must forward. This is the one obligation on the
  consumer, and the docs say so.

### Plumbing

`PretableSurface` merges `components` over the built-in defaults, memoises the
result keyed on the identity of each value (so an inline object literal does
not re-render every button per keystroke), and publishes it on a React
context. Call sites read `const { Button } = usePretableComponents()` — an
internal hook, not exported. The default context value is the built-in map, so
a component rendered outside any surface still works.

## Migration of the call sites

Twelve sites become kit components; two stay out on purpose.

| becomes                    | sites                                                                                                                  |
| -------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `Button variant="outline"` | `filter-add` (×2), `add-group`, `expand-all`, `collapse-all`                                                           |
| `Button variant="link"`    | `filter-clear`, `tool-reset`                                                                                           |
| `IconButton`               | `filter-funnel`, `column-menu-button`, `tool-row-menu-button`, `chip-remove`, `filter-row-remove`, `tool-group-remove` |
| **stays**                  | `filter-join` (a pressed-state toggle, not a push-button), `pane-resize` (a separator handle)                          |

Each site **keeps its existing `data-pretable-*` attribute**, passed through as
a prop. Every selector in `grid.css`, every e2e locator and every consumer
stylesheet keyed on `[data-pretable-filter-clear]` keeps working unchanged.
That is what makes the migration safe to land in one PR: nothing that
identifies a button today stops identifying it. The site name for each is
its existing attribute suffix (`filter-clear`, `tool-reset`, …), so there is
one vocabulary, not two.

What moves is the **shared look**. The four ghost actions carry a
four-selector rule list in `grid.css` for the same 24px box, radius, padding,
accent ink and hover tint; it collapses onto
`[data-pretable-button][data-pretable-variant="ghost"]` and the site rules
shrink to what is genuinely site-specific. The icon buttons share everything
but their size — 14px, 18px and 24px boxes exist — so the shared
`[data-pretable-icon-button]` rule carries the box minus its dimensions and
each site keeps its size, its hover and its reveal. `grid.css` gets smaller.

The pixel must not move. Before touching a site, its computed box, colours,
hover and focus are recorded; after, they are re-measured. Any difference is a
finding, not an acceptable drift.

## Testing

- **Component tests** (jsdom, `packages/react/src/__tests__/`): `type="button"`
  always; attributes and `data-pretable-site` land; `className`/`style` merge
  rather than replace; the ref reaches the node; `disabled` is reflected.
- **Type tests** (`type-tests/`): omitting `aria-label` on IconButton fails to
  compile; `type` is not accepted on either; `site` accepts an unknown string.
- **Override tests**: `components={{ Button }}` on the surface renders the
  replacement at a known site with the right `site`; a stable map yields a
  stable context value (re-rendering with the same map does not remount
  buttons); a replacement inside a **portalled** menu renders — the test that
  proves the context-over-props decision.
- **CSS guards** (`css-cascade.test.ts`): the variant rules exist and carry
  `:hover:not(:disabled)`; the disabled treatment covers the new attributes;
  the collapsed site rules do not come back. Mutation-tested, like the rest of
  that file.
- **Browser**: a `/fixtures/components` page with an override, asserted in the
  website e2e; the hero re-measured for all three looks; **and
  `pnpm bench:e2e`** — leaving the bench suite out is what broke #577.
- **Accessibility**: every migrated site keeps its accessible name, asserted by
  `getByRole("button", { name })`.

## Docs and API surface

- A "Components" docs page covering Button and IconButton, leading with a live
  example per the examples-first standard.
- The `components` prop on the surface reference page.
- Both tables registered with the api-surface guard, which fails closed on an
  unregistered table.
- `pnpm build` then `pnpm api`; a **minor** changeset for `@pretable/react`
  (new public API) and a patch for `@pretable/ui`.

## Out of scope

Menu items, checkboxes, tabs, the twisty, header cells, Select and every
input — each waits for its own component and sub-project. No `size`, `tone`,
`loading` or icon-slot props. No `classNames` map, no unstyled build, no
per-site override names. No change to the Excel theme.
