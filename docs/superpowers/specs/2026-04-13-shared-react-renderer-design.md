# Shared React Renderer Design

Date: 2026-04-13

## Summary

Pretable should extract a single internal React renderer surface that owns the benchmark-sensitive DOM contract and the core inspection-table interaction layer. The extraction is internal-only for now. It must unify the default `Pretable` component and the playground inspection demo on one renderer-owned path while keeping product chrome such as filters, sidebars, and status cards outside the renderer.

The extracted renderer must own header rendering, pinned-column layout, virtualized row shells, row-height measurement, selection and focus visuals, keyboard navigation, and sort-header behavior. Consumers may customize header and cell content through narrow render callbacks, but they must not replace the row shell, scroll viewport, pinned layout structure, or benchmark DOM markers.

## Problem

The repo now shares the `usePretableModel()` hook between `@pretable/react` and the playground, but the actual DOM surface still forks immediately after that hook.

Current divergence:

- `packages/react/src/pretable.tsx` and `apps/playground/src/inspection-demo.tsx` both build separate virtualized DOM surfaces from the same model output.
- The public component and the playground duplicate width fallback logic, row iteration, row positioning, and scroll viewport wiring.
- The public component owns measurement correction, but the playground currently does not.
- The playground honors `column.getValue`, pinned-column offsets, keyboard interaction, and sort-header behavior in its own surface, while the public component does not own the same behavior.

That is the wrong shape for the current phase. It leaves the benchmark path, the public component path, and the prototype path too easy to drift apart.

## Goals

- Unify `Pretable` and the playground inspection table on one internal React renderer-owned DOM path.
- Preserve the benchmark DOM contract and scroll policy notes.
- Include pinned headers, pinned body cells, selection/focus visuals, keyboard navigation, and sort behavior in the shared renderer.
- Include row-height measurement in the shared renderer so variable-height correction is exercised on the same path.
- Keep the extracted surface internal until the renderer shape is proven across both benchmark and playground usage.

## Non-Goals

- Designing a new public renderer customization API.
- Moving playground toolbar, sidebar, or detail-panel chrome into the renderer.
- Refactoring benchmark runtime selectors or changing metric semantics.
- Solving streaming updates, off-screen autosize, or broader MVP feature expansion in this slice.

## Recommended Approach

Extract one internal `PretableSurface` inside `packages/react` that owns the DOM structure and benchmark contract, and accepts narrow render callbacks for header-cell and body-cell inner content.

Why this approach:

- It is strong enough to stop renderer drift at the DOM and interaction seams that matter.
- It keeps callbacks narrow, which avoids prematurely designing a public slot-based API.
- It lets the simple `Pretable` component and the richer playground demo share one renderer path in a single pass.

Rejected alternatives:

- Header/body split extraction: too easy to leave pinned offsets, keyboard handling, and interaction semantics fragmented.
- Body-only extraction: too weak for the current goal because header sort behavior and pinned layout would still fork.

## Architecture

### Internal renderer unit

Add an internal surface module under `packages/react/src/internal/`, centered around a component such as `PretableSurface`.

It should accept:

- a `PretableModel`
- viewport configuration
- optional measurement enablement
- narrow render callbacks for header-cell and body-cell content
- optional presentational hooks for extra class names and non-structural DOM attributes on header cells, rows, and body cells

It should own:

- the scroll viewport element
- the scroll content sizing wrapper
- the sticky header row
- absolute row positioning
- pinned-left offset calculation and sticky behavior
- row-height measurement capture and measured-height state updates
- sort-button click behavior
- row selection and focus attributes
- keyboard navigation and selection activation
- benchmark DOM markers and row metadata

### Callback boundary

The renderer should own its own measured-height state and pass that state into the render-model path itself. Wrappers must not keep separate measured-height maps after this extraction.

Callbacks and hooks are allowed to control:

- header-cell inner content
- body-cell inner content
- extra class names
- non-structural DOM attributes on header cells, rows, and body cells

Callbacks are not allowed to control:

- scroll viewport ownership
- row shell markup
- benchmark marker placement
- pinned layout structure
- measurement ref ownership

That keeps the renderer honest and prevents a second renderer fork disguised as “customization.”

## Benchmark Contract

The extracted renderer must preserve the existing Pretable benchmark contract:

- viewport selector: `[data-pretable-scroll-viewport]`
- row selector: `[data-pretable-row]`
- cell selector: `[data-pretable-cell]`
- row index attribute: `data-row-index`
- row id attribute: `data-row-id`
- row height attribute: `data-row-height`
- row positioning and cell geometry readable from the row shell
- viewport subtree shape remaining compatible with benchmark DOM-node counting
- the effective scroll owner remaining the same element the harness targets

It must also preserve current viewport policy behavior:

- `overflow: auto`
- `overflow-anchor: none`
- `overscroll-behavior: contain`

It must preserve the behavior that current benchmark notes and sampling rely on:

- viewport-policy notes still readable from the real scrolling element
- row geometry still sampled from the row shell
- scroll-path smoke coverage run against the wrapped-text `S2` scroll scenario, not only initial render

Any extraction that moves or renames those markers, or inserts a new effective scroller, changes benchmark semantics and is out of scope.

## Behavior

The renderer should provide the following default behavior:

- sticky header row with sort buttons
- virtualized measured body rows rendered from `renderSnapshot`
- pinned-left sticky behavior for both header and body
- row-height measurement feedback into the render-model path
- `ArrowUp` / `ArrowDown` move focus
- `Enter` / `Space` select the focused row
- focus and selection state mapped into stable row and cell attributes

`Pretable` should become a thin wrapper over this renderer with the current simple visual treatment.

The playground inspection demo should use the same renderer with richer header/cell content and its existing toolbar/sidebar outside the renderer.

## Testing

This extraction should be TDD-first and should add explicit coverage for the shared renderer seam.

Required tests:

- renderer tests for:
  - accessor-aware cell rendering
  - pinned offset behavior
  - sort-header behavior
  - keyboard navigation and selection
  - measured-height feedback
  - benchmark marker preservation
- `Pretable` tests proving the default wrapper still works on top of the renderer
- playground tests proving the inspection demo still sorts, filters, selects, and navigates
- bench-adapter or bench-app tests proving the Pretable path still exposes the expected DOM contract

## Risks

- Breaking benchmark semantics by moving markers or scroll ownership.
- Breaking measurement by changing which node owns row chrome or cell markers.
- Letting callbacks become too broad and recreating a hidden renderer fork.
- Pulling too much playground-specific product behavior into the renderer instead of keeping it renderer-generic.

## Success Criteria

This slice is successful if:

- `Pretable` and the playground share one renderer-owned DOM path
- benchmark selectors and metric semantics remain intact
- row-height measurement and pinned layout are no longer duplicated or split
- keyboard navigation, sort-header behavior, and selection/focus visuals are shared
- the renderer remains internal, with no premature public customization contract
