/**
 * Consumer-level type tests: these resolve `@pretable/core` and
 * `@pretable/react` to their BUILT `.d.ts`, which is the surface a published
 * consumer sees. Run by `pnpm typecheck:public`.
 *
 * **What they pin.** `PretableReactGrid.moveFocus` used to spell its movement
 * union out by hand instead of importing `PretableIndexedFocusMovement`. When
 * `"first-column"` and `"last-column"` were added to the real union, the copy
 * did not follow, the build broke, and the repair was a cast at the call site
 * in `pretable-surface.tsx` — so the handle stayed two members behind while
 * looking fine.
 *
 * The assertions below are `Equal`, not "accepts these strings". A test that
 * only fed literals through would still pass against a stale copy that happened
 * to contain them, and would keep passing if the handle were widened to
 * `string`. `Equal` fails in BOTH directions: if a member is added to
 * `PretableIndexedFocusMovement` and the handle does not follow, and if the
 * handle grows a member the engine cannot execute.
 *
 * Adding a member to `PretableIndexedFocusMovement` must NOT require editing
 * `pretable-model.ts`. It does require editing `EVERY_MOVEMENT` here, which is
 * the point: that list is the runtime counterpart, exercised by
 * `packages/react/src/__tests__/move-focus-movements.test.tsx`, and a movement
 * nobody drives is a movement nobody has checked.
 */
import {
  createColumnHelper,
  type PretableIndexedFocusMovement,
  type PretableIndexedMoveFocusOptions,
} from "@pretable/core";
import { usePretable, type PretableReactGrid } from "@pretable/react";
import type { Equal, Expect } from "../shared/assert";

interface Holding {
  id: number;
  symbol: string;
  quantity: number;
}

const column = createColumnHelper<Holding>();
const columns = [
  column.accessor("symbol", { type: "text" }),
  column.accessor("quantity", { type: "number" }),
] as const;

const rows: readonly Holding[] = [{ id: 1, symbol: "PRE", quantity: 10 }];

const { grid } = usePretable({ rows, columns, viewportHeight: 320 });

type Grid = typeof grid;
type MoveFocus = Grid["moveFocus"];

/**
 * The handle's movement parameter IS the engine's union — not a superset, not a
 * subset, and not `string`.
 */
type _MovementIsTheRealUnion = Expect<
  Equal<Parameters<MoveFocus>[0], PretableIndexedFocusMovement>
>;

/** Same for the options, which were a duplicated `{ pageRows?: number }`. */
type _OptionsAreTheRealOptions = Expect<
  Equal<Parameters<MoveFocus>[1], PretableIndexedMoveFocusOptions | undefined>
>;

/**
 * The column edges specifically: the two members the hand-copied union was
 * missing. Kept as their own assertion so a regression names them.
 */
type _ColumnEdgesReachable = Expect<
  Equal<
    Extract<Parameters<MoveFocus>[0], "first-column" | "last-column">,
    "first-column" | "last-column"
  >
>;

/**
 * Every member, enumerated. Exhaustive by construction: it is typed as the
 * union itself, so dropping one makes the array's element type narrower than
 * `PretableIndexedFocusMovement` and `_EveryMovementEnumerated` fails.
 */
export const EVERY_MOVEMENT = [
  "up",
  "down",
  "left",
  "right",
  "page-up",
  "page-down",
  "home",
  "end",
  "first-column",
  "last-column",
  "tab",
  "shift-tab",
  "parent",
] as const satisfies readonly PretableIndexedFocusMovement[];

type _EveryMovementEnumerated = Expect<
  Equal<(typeof EVERY_MOVEMENT)[number], PretableIndexedFocusMovement>
>;

for (const movement of EVERY_MOVEMENT) grid.moveFocus(movement);
grid.moveFocus("page-down", { pageRows: 12 });

/**
 * `PretableReactGrid` names the same signature when spelled by a consumer
 * generically, so the guarantee is not an artifact of inference at this one
 * call site.
 */
type DeclaredGrid = PretableReactGrid<Holding, number, typeof columns>;
type _DeclaredMovement = Expect<
  Equal<Parameters<DeclaredGrid["moveFocus"]>[0], PretableIndexedFocusMovement>
>;

export type FocusMovementAssertions = [
  _MovementIsTheRealUnion,
  _OptionsAreTheRealOptions,
  _ColumnEdgesReachable,
  _EveryMovementEnumerated,
  _DeclaredMovement,
];
