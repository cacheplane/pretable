import { describe, expect, expectTypeOf, it } from "vitest";

import type {
  PretableEditStatus,
  PretableExpansionState,
  PretableIndexedEditingState,
  PretableOpenEditStatus,
} from "@pretable/core";

import { hidesCollapsedRows } from "../csv";

/**
 * Two copies of a named union had been widened to `string` and then compared
 * against string literals. A `string` makes every such comparison unchecked:
 * renaming the phase, or typo-ing the literal, compiles and silently changes
 * behavior. These assertions are the compiler-enforced half of the fix — the
 * behavioral half lives in `pretable-surface-editing.test.tsx` (the edit
 * lifecycle) and `csv.test.ts` (export completeness).
 *
 * Every `@ts-expect-error` below is load-bearing in BOTH directions: it fails
 * as an unused directive the moment the field widens back to `string`.
 */

type Columns = readonly [
  {
    readonly id: "name";
    readonly accessor: (row: { id: string; name: string }) => string;
  },
];
type EditingStatus = NonNullable<
  PretableIndexedEditingState<string, Columns>
>["status"];

describe("edit status is a checked union", () => {
  it("names the post-authorization phases", () => {
    // The union that appeared unnamed in four places, now named once.
    expectTypeOf<PretableOpenEditStatus>().toEqualTypeOf<
      "editing" | "validating" | "saving" | "error"
    >();
    // THE ANTI-DRIFT CLAUSE. Both unions spell their members out, because the
    // docs guard pins a table to the members the API report states and an
    // `Exclude<>` hides them. That leaves two lists that could disagree, so
    // their relationship is asserted here instead: `PretableEditStatus` is
    // exactly `"checking"` plus the open phases, no more and no less.
    expectTypeOf<PretableEditStatus>().toEqualTypeOf<
      "checking" | PretableOpenEditStatus
    >();
    expectTypeOf<
      Exclude<PretableEditStatus, "checking">
    >().toEqualTypeOf<PretableOpenEditStatus>();
  });

  it("keeps 'checking' reachable in the observable editing state", () => {
    // THE BUG. The store's editing state excluded `"checking"` while
    // `useCellEditController` asked `beginEdit` to open in it and three
    // consumers (`useEditorField`'s pending set, `BooleanCellControl`, the
    // controller's own gate) compared against it — comparisons no value could
    // ever satisfy. The surface facade's `status: string` is what kept the
    // compiler quiet about all of them.
    expectTypeOf<"checking">().toMatchTypeOf<EditingStatus>();
    expectTypeOf<EditingStatus>().toEqualTypeOf<PretableEditStatus>();
  });

  it("rejects a status the union cannot produce", () => {
    const status = "editing" as EditingStatus;
    // @ts-expect-error -- a typo'd phase has no overlap with the union. Unused
    // (and therefore itself an error) if `status` ever widens to `string`.
    const typo: boolean = status === "editting";
    void typo;
  });

  it("keeps 'checking' out of the post-authorization transitions", () => {
    // Nothing can return to `"checking"`; only `beginEdit` can enter it. That
    // is the entire reason `PretableOpenEditStatus` exists as a second name.
    // @ts-expect-error -- `"checking"` is not an open-edit transition.
    const notATransition: PretableOpenEditStatus = "checking";
    void notATransition;
  });
});

describe("expansion kind is a checked union", () => {
  it("accepts the real expansion state", () => {
    const expanded: PretableExpansionState = {
      default: { kind: "expanded" },
      overrideCount: 0,
    };
    expectTypeOf(expanded).toMatchTypeOf<
      Parameters<typeof hidesCollapsedRows>[0]
    >();
    expect(hidesCollapsedRows(expanded)).toBe(false);
  });

  it("rejects a typo'd expansion kind", () => {
    // The comparison inside `hidesCollapsedRows` is what decides whether a
    // CSV export reports `complete: true` or a `collapsed-groups` omission.
    // Before the narrowing the parameter was `{ default: { kind: string } }`,
    // so this call compiled and this directive went unused.
    hidesCollapsedRows({
      // @ts-expect-error -- "expandedd" is not a PretableExpansionDefault kind.
      default: { kind: "expandedd" },
      overrideCount: 0,
    });
  });

  it("rejects an expansion shape the row model never publishes", () => {
    hidesCollapsedRows({
      // @ts-expect-error -- the through-depth variant also carries `depth`.
      default: { kind: "through-depth" },
      overrideCount: 0,
    });
  });
});
