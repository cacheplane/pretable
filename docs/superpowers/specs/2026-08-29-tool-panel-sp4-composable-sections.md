# Composable Sections (Tool Panel SP4) — Design

**Status:** approved direction, specced in full.
**Parents:** `2026-08-24-tool-panel-design.md` (which designed the shell for
this and deliberately did not build it: "export the descriptor type and
accept custom descriptors through the `toolPanel` prop"), and the three
shipped sections (SP1 columns, SP2b filters, SP3b grouping).

## What this is

Consumer-supplied tool-panel sections: a public descriptor type and a
`sections` roster on the `toolPanel` config, so an application can add its
own panes to the rail, hide built-ins it does not want, and order the tabs —
without the shell learning anything new. The shell was built for this
(`sections.ts`: "nothing in the shell may assume the union is closed at
runtime"); SP4 opens the door it left unlocked.

Doing this now, before external consumers exist, is deliberate: the
descriptor shape becomes API, and every month it stays internal is a month
of freedom to get it wrong cheaply.

## Decisions locked (and why)

1. **One primitive: `sections` is the COMPLETE roster.**

   ```ts
   interface PretableToolPanelConfig {
     // existing fields unchanged, but see decision 3 for their id type
     readonly sections?: readonly (
       | ToolPanelSectionId // a built-in, by id
       | PretableToolPanelSection // a custom section, by descriptor
     )[];
   }
   ```

   Present, it states the whole rail in order — built-ins referenced by id
   (`"columns"`, `"filters"`, `"grouping"`), custom sections as descriptor
   objects, freely interleaved. Absent, the rail is the three built-ins,
   exactly as today. This one shape subsumes append, hide, reorder, and
   interleave. Rejected: an append-only `extraSections` array plus per-id
   `builtins` toggles — two concepts, and it still cannot express "my
   section between columns and filters"; and a `Record<id, boolean|descriptor>`
   — loses ordering, which a rail visibly has.

2. **The public descriptor is minimal and render-owned:**

   ```ts
   interface PretableToolPanelSection {
     readonly id: string; // non-empty, no whitespace (it becomes a DOM id part)
     readonly icon: ComponentType<{ className?: string }>;
     readonly label: string; // rail tooltip + tab accessible name
     readonly render: () => ReactNode;
   }
   ```

   - `label` is a **plain string**, not a message key: a custom section is
     consumer-owned UI, and the consumer localizes it where they localize
     the rest of their app. The messages layer stays the built-ins'.
   - `render` takes **no arguments**. A section that needs the grid holds
     the handle via the existing `onGridReady` prop (documented with an
     example); everything else it needs, it closes over. Rejected: a typed
     context argument — it drags the surface's three generics into a public
     type for a need `onGridReady` already serves, and adding a parameter
     later is non-breaking, so YAGNI cuts cleanly.
   - The internal `ToolPanelSectionDescriptor` stays internal; the surface
     converts. The shell's id type widens from the union to `string`
     internally — a rename of what it already does (it treats ids as data).

3. **Active-section fields widen to `ToolPanelSectionId | (string & {})`.**
   A custom id must be nameable in `defaultActiveSection` / `activeSection`
   / `onActiveSectionChange`. The `(string & {})` intersection keeps
   editor autocomplete for the three built-in literals while accepting any
   string — the established TS idiom for open-but-suggested unions.
   Exported as `PretableToolPanelSectionId`; `ToolPanelSectionId` itself
   stays the closed built-in union (the docs guard's prose enumeration and
   the roster-parsing discriminator both depend on it staying closed).

4. **Roster validation throws, synchronously, at descriptor construction.**
   A duplicate id (custom vs built-in, or custom vs custom), an empty id,
   or an id containing whitespace (it is interpolated into `tabId` and
   `aria-labelledby`, where HTML ids forbid it) is a **programming error
   present from the first render** — unlike the data-dependent
   invalid-aggregate case, it cannot lurk. The throw message names the id
   and the rule. Rejected: warn-and-drop — a silently missing tab is the
   harder bug to find; and reusing a built-in id to REPLACE that section —
   a real feature someday, but it needs its own design (what happens to the
   built-in's messages, config, and e2e contracts?), so today it is the
   same error as any other collision, and the error message says
   replacement is not supported rather than leaving it ambiguous.

5. **An `activeSection` naming an id not in the roster renders rail-only.**
   This is today's behavior (`ToolPanel` finds no match, opens nothing) and
   it is right: a controlled consumer may set the id a frame before the
   roster carries it, and punishing that with a throw would make the
   controlled form unusable. Documented, and pinned by a test rather than
   left as an accident.

6. **Custom sections inherit the shell's a11y contract for free, and the
   docs state what they owe in return.** The pane is the same
   `role="tabpanel"` labelled by the tab; Escape returns focus to the rail
   tab; the pane unmounts when closed; the rail stays one tab stop. What
   the shell cannot enforce is the content's own conduct, so the docs page
   states the two rules a custom section must keep: every interactive
   control reachable by Tab in DOM order, and **no focus trap** — forward
   Tab from the last control must leave the panel (the repo's WCAG-A
   history makes this the loudest sentence on the page). The existing
   tab-exit e2e keeps guarding the built-ins; a new e2e case walks a custom
   section to prove the shell holds for consumer content.

7. **Descriptor memo semantics are preserved, and the cost of an inline
   roster is documented, not fought.** The surface's `toolPanelSections`
   memo gains the parsed roster as a dep. A consumer who builds the
   `sections` array inline re-creates it every render — the descriptor
   array rebuilds, which costs a little work and nothing else (React
   reconciles the pane by position; same paragraph the memo already
   carries for `processing`). The stable-deps rule is untouched: the
   roster is a prop-derived value. The SP3b stability test must still pass
   unchanged (engine-only changes rebuild nothing), and gains a sibling
   assertion: with a STABLE custom roster, identity is stable too.

## Architecture

Modified files, all in `packages/react`:

- `src/tool-panel/sections.ts` — internal descriptor's `id` widens to
  `string`; the file exports the two new public types
  (`PretableToolPanelSection`, `PretableToolPanelSectionId`) beside
  `ToolPanelSectionId`.
- `src/tool-panel/ToolPanel.tsx`, `Rail.tsx`, `focus.ts` — id type
  widening only; no behavior change.
- `src/pretable-surface.tsx` — `PretableToolPanelConfig` gains `sections`;
  the active-section fields widen per decision 3; a pure
  `resolveToolPanelRoster(sections, builtinDescriptors)` helper parses,
  validates (decision 4), and orders; the descriptor memo consumes it.
- `src/index.ts` — the new types export.

The roster resolver lives beside the section machinery as a **pure
function** (`src/tool-panel/roster.ts`) so validation and ordering are
testable without React — the repo's established split.

## Behavior details that are decisions, not details

- **`sections: []` is legal and means "no sections": rail hidden, pane
  closed** — the panel effectively off, equivalent to `toolPanel={false}`
  but reachable from a dynamic roster without switching prop shapes. An
  empty rail (a bare vertical strip with no tabs) serves nobody.
- **`data-pretable-section` carries the custom id verbatim** — it is the
  consumer's own vocabulary, and the attribute contract's sweep constrains
  attribute NAMES, not values.
- **Built-in sections referenced by id keep every behavior they have
  today** — messages, config coupling, e2e contracts. The roster only
  selects and orders them.
- **SSR: custom tabs are inert until `data-pretable-hydrated`**, like
  every other control; the docs page's hydration note extends to them.

## Verification

- **Pure unit (`roster.ts`):** ordering (interleave, reorder, subset);
  validation throws for duplicate/empty/whitespace ids with the exact
  message; built-in ids resolve to the built-in descriptors; empty roster.
- **jsdom:** a custom section renders in the pane and its tab in the rail,
  in roster order; hiding a built-in removes its tab (and the others
  survive — positive twin); `defaultActiveSection` and controlled
  `activeSection` work with a custom id; unknown active id → rail-only
  (decision 5); `sections` absent → the three built-ins byte-for-byte
  (assert-the-old-behavior: the SP1/2b/3b suites already pin the sections
  themselves — add the roster-level assertion); the stability sibling
  (decision 7); `sections: []` hides the rail.
- **Mutation checks:** drop the duplicate-id validation → the throw test
  fails; make the roster resolver ignore order → the ordering test fails.
- **Playwright:** a custom section (registered in a fixture page) is
  reachable by keyboard — one rail stop in, arrows include the custom tab,
  Enter opens it, forward-Tab exits without a trap; the existing
  `grid-tab-wrap-rows` guard still green.
- **Docs:** `grid/tool-panel.mdx` grows a "Custom sections" section with a
  live example (a small custom pane using `onGridReady`), the two conduct
  rules (decision 6), the inline-roster cost note, and the collision
  error's meaning. New public types join the api report (`pnpm build`
  before `pnpm api`); the docs guard's rosters take whatever registration
  they fail-closed demand.
- **Changesets:** `@pretable/react` minor.

## Out of scope

Replacing a built-in section by reusing its id (collision error today, own
design if ever wanted); a context argument to `render` (non-breaking to add
later); per-section pane widths; panel placement (left edge); persisting
the active section; the `<Pretable>` preset growing section-authoring props
beyond forwarding `toolPanel` verbatim (it already forwards).
