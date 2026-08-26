// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createColumnHelper, createLocalRowModel } from "@pretable/core";

import type { SurfaceFilterGroup, SurfaceFilterNode } from "../filter-tree";
import {
  defaultDraft,
  fromColumnFilter,
  operatorsForType,
  type FilterDraft,
} from "../filter-menu/filter-operators";
import {
  FilterRow,
  type FilterRowColumn,
} from "../tool-panel/filters/FilterRow";
import { FiltersSection } from "../tool-panel/filters/FiltersSection";
import { JoinControl } from "../tool-panel/filters/JoinControl";
import { defaultMessages } from "../messages";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("JoinControl", () => {
  /**
   * A sibling run, rendered the way the section will render one: ONE `op`
   * held above the rows and handed to every connective in the run.
   *
   * The run is the unit under test as much as the component is. A sibling
   * list has exactly one `op` in the engine, so "changing any one changes
   * them all" is not an emergent nicety — it is the model, and the only way
   * to see it is to render more than one control over shared state.
   *
   * `fixed` plays the root array, whose implicit AND has no `op` to set.
   */
  function SiblingRun({
    count,
    initial = "and",
    fixed = false,
    onChange,
  }: {
    count: number;
    initial?: SurfaceFilterGroup["op"];
    fixed?: boolean;
    onChange?: (op: SurfaceFilterGroup["op"]) => void;
  }) {
    const [op, setOp] = useState<SurfaceFilterGroup["op"]>(initial);
    const commit = (next: SurfaceFilterGroup["op"]) => {
      setOp(next);
      onChange?.(next);
    };
    return (
      <>
        {Array.from({ length: count }, (_unused, index) => (
          <JoinControl
            key={index}
            first={index === 0}
            op={op}
            onChange={fixed ? undefined : commit}
            messages={defaultMessages}
          />
        ))}
      </>
    );
  }

  /**
   * Every connective in `container`, in document order — FLAT. That is exact
   * for one run and meaningless for a tree: once the section renders nested
   * rails, each run brings its own `Where` and they interleave here by
   * position. A tree test must scope to a rail before it counts.
   */
  const joins = (container: HTMLElement) =>
    Array.from(
      container.querySelectorAll<HTMLElement>("[data-pretable-filter-join]"),
    );

  /** The word, as a sighted user reads it: the child that is not hidden. */
  const visibleText = (join: HTMLElement) =>
    join.querySelector("span:not([aria-hidden])")?.textContent ??
    join.textContent;

  it("gives the run's first row a non-interactive `Where`", () => {
    const { container } = render(<SiblingRun count={1} />);

    const [where, ...rest] = joins(container);
    expect(rest).toHaveLength(0);
    expect(where).toHaveTextContent("Where");
    expect(where?.tagName).not.toBe("BUTTON");
    expect(container.querySelector("button")).toBeNull();
  });

  it("gives every later row a button reading the run's join", () => {
    const { container } = render(<SiblingRun count={2} />);

    const [where, second] = joins(container);
    expect(joins(container)).toHaveLength(2);
    expect(where).toHaveTextContent("Where");
    // The CSS has a rule keyed on `button[data-pretable-filter-join]`; a
    // non-button here would silently lose its box, border and hit target.
    expect(second?.tagName).toBe("BUTTON");
    expect(second).toHaveTextContent("and");
    // It sets a value rather than toggling itself, so it is not pressed-state.
    expect(second).not.toHaveAttribute("aria-pressed");
    expect(second?.getAttribute("aria-label")).toMatch(/\bor\b/);
  });

  /* The root of the tree is a bare array — an implicit AND with no `op` field
     to set — so its run has a join to SHOW and nothing to change. A button
     wired to a no-op would look live, take focus and promise a change it
     cannot make. */
  it("renders a run whose join is fixed without an affordance to change it", () => {
    const { container } = render(<SiblingRun count={3} fixed />);

    const [where, ...rest] = joins(container);
    expect(where).toHaveTextContent("Where");
    expect(rest).toHaveLength(2);
    for (const join of rest) {
      expect(join.tagName).toBe("SPAN");
      expect(join).toHaveTextContent("and");
      expect(join).not.toHaveAttribute("aria-label");
    }
    expect(container.querySelector("button")).toBeNull();
  });

  it("reports the OTHER join when clicked", () => {
    const onChange = vi.fn();
    const { container } = render(<SiblingRun count={2} onChange={onChange} />);

    fireEvent.click(joins(container)[1]!);
    expect(onChange).toHaveBeenCalledWith("or");

    fireEvent.click(joins(container)[1]!);
    expect(onChange).toHaveBeenLastCalledWith("and");
  });

  it("changes the WHOLE run, not the row that was clicked", () => {
    const { container } = render(<SiblingRun count={3} />);

    const before = joins(container);
    expect(before[1]).toHaveTextContent("and");
    expect(before[2]).toHaveTextContent("and");

    // The third row's control — so a component that kept its own state would
    // leave the second one reading `and`.
    fireEvent.click(before[2]!);

    const after = joins(container);
    expect(after[1]).toHaveTextContent("or");
    expect(after[2]).toHaveTextContent("or");
    // And the label now offers the way back, for the whole run.
    expect(after[1]?.getAttribute("aria-label")).toBe(
      after[2]?.getAttribute("aria-label"),
    );
  });

  it("leads its accessible name with the join it is showing", () => {
    const { container } = render(<SiblingRun count={2} initial="or" />);

    const button = joins(container)[1]!;
    expect(button).toHaveTextContent("or");
    expect(button.getAttribute("aria-label")).toBe(
      "or, join all conditions in this list with and",
    );
  });

  /* SC 2.5.3 Label in Name — the assertion this suite was missing. The
     component's TSDoc carries the reasoning, including why `ColumnPinMenu`
     is no precedent for a bare next-value name. */
  it.each(["and", "or"] as const)(
    "contains its visible text `%s` in its accessible name",
    (initial) => {
      const { container, getByRole } = render(
        <SiblingRun count={2} initial={initial} />,
      );

      const button = joins(container)[1]!;
      expect(visibleText(button)).toBe(initial);
      expect(button.getAttribute("aria-label")).toContain(initial);

      // And the literal speech-input path: a Voice Control user reads the
      // word off the screen and says "click and". Anchored, because the
      // trailing promise names the OTHER join and would match either way.
      expect(getByRole("button", { name: new RegExp(`^${initial}\\b`) })).toBe(
        button,
      );
    },
  );

  /* The stylesheet's row-alignment argument rests on BOTH shapes taking the
     shared 24px box, which they do by both carrying the attribute — the
     button rule only adds to it. No CSS guard can see the DOM, so this is
     the only place that can hold the non-button half of the contract. */
  it("puts the join attribute on the non-button `Where` too", () => {
    const { container } = render(<SiblingRun count={2} />);

    const where = container.querySelector("[data-pretable-filter-join]")!;
    expect(where.tagName).toBe("SPAN");
    expect(where).toHaveTextContent("Where");
  });
});

/**
 * The roster a section hands down, and the queries every row test asks of the
 * DOM. MODULE SCOPE, unlike `joins()` inside the JoinControl describe: that
 * helper is flat by construction and wrong for a tree, so it is scoped to keep
 * a later suite from reaching for it. These are the opposite case — Task 5's
 * section tests need the same roster and the same queries, and two rosters
 * that drift apart is how a section test comes to disagree with a row test
 * about what a column is.
 *
 * The roster covers every branch a row can take: the four value shapes, both
 * set-shaped types, a hidden column, a column that prunes its operator set,
 * and a pair of enum columns whose options only partly overlap.
 */
const COLUMNS: FilterRowColumn[] = [
  { id: "name", label: "Name", type: "text" },
  { id: "notes", label: "Notes", type: "text" },
  { id: "revenue", label: "Revenue", type: "number" },
  {
    id: "status",
    label: "Status",
    type: "enum",
    options: [
      { value: "open", label: "Open" },
      { value: "won" },
      { value: "lost", label: "Lost" },
    ],
  },
  // Overlaps `status` on `open` and nothing else — a column change between
  // the two can keep part of a selection and must drop the rest.
  {
    id: "substatus",
    label: "Substatus",
    type: "enum",
    options: [
      { value: "open", label: "Open" },
      { value: "blocked", label: "Blocked" },
    ],
  },
  // Set-shaped like an enum, but its choices are implicit: `resolveColumnOptions`
  // supplies True/False for a boolean column that declares none.
  { id: "verified", label: "Verified", type: "boolean" },
  // Enum with NO declared options and no distinct-value reader — the state the
  // row cannot tell apart from "still loading".
  { id: "owner", label: "Owner", type: "enum" },
  { id: "region", label: "Region", type: "text", hidden: true },
  // A column that PRUNES its type's operator set. Nothing else in this suite
  // declares `filterOperators`, and the render list behaves identically for
  // every column that does not.
  {
    id: "stage",
    label: "Stage",
    type: "text",
    filterOperators: ["contains", "isEmpty"],
  },
];

const row = (container: HTMLElement) =>
  container.querySelector<HTMLElement>("[data-pretable-filter-row]")!;
const operatorSelect = (container: HTMLElement) =>
  container.querySelector<HTMLSelectElement>(
    "select[data-pretable-filter-row-operator]",
  )!;
const columnSelect = (container: HTMLElement) =>
  container.querySelector<HTMLSelectElement>(
    "select[data-pretable-filter-row-column]",
  )!;
/** Every value control the row is currently rendering, in document order. */
const values = (container: HTMLElement) =>
  Array.from(
    container.querySelectorAll<HTMLElement>("[data-pretable-filter-row-value]"),
  );
const options = (select: HTMLSelectElement) =>
  Array.from(select.options).map((o) => o.value);
/** The checked boxes of a set-shape row, as the filter value they encode. */
const checkedValues = (container: HTMLElement) =>
  Array.from(
    container.querySelectorAll<HTMLInputElement>("input[type=checkbox]"),
  )
    .filter((b) => b.checked)
    .map((b) => b.value);

describe("FilterRow", () => {
  /**
   * One leaf, held the way the section will hold it: the `{ columnId, draft }`
   * pair lives ABOVE the row and comes back down as props. The row keeps no
   * state, so a harness that dropped the update would render a dead control —
   * which is what every assertion below would then catch.
   */
  function Leaf({
    columnId: initialColumnId = "name",
    draft: initialDraft,
    onRemove,
    onChange,
    distinctValues,
  }: {
    columnId?: string;
    draft?: FilterDraft;
    onRemove?: () => void;
    onChange?: (next: { columnId: string; draft: FilterDraft }) => void;
    distinctValues?: (columnId: string) => string[];
  }) {
    const [leaf, setLeaf] = useState(() => ({
      columnId: initialColumnId,
      draft:
        initialDraft ??
        defaultDraft(
          COLUMNS.find((c) => c.id === initialColumnId)!.type ?? "text",
        ),
    }));
    return (
      <FilterRow
        columns={COLUMNS}
        columnId={leaf.columnId}
        draft={leaf.draft}
        onChange={(next) => {
          setLeaf(next);
          onChange?.(next);
        }}
        onRemove={onRemove ?? (() => {})}
        distinctValues={distinctValues}
        messages={defaultMessages}
      />
    );
  }

  it("offers a text column its text operators and one value input", () => {
    const { container } = render(<Leaf />);

    expect(row(container)).toBeInTheDocument();
    // The type's own list, from filter-operators — not a re-derivation.
    expect(options(operatorSelect(container))).toEqual(
      operatorsForType("text"),
    );
    expect(options(operatorSelect(container))).toContain("contains");
    // A text column has no `between`; offering one would render a range whose
    // engine filter the type cannot evaluate.
    expect(options(operatorSelect(container))).not.toContain("between");

    const [only, ...rest] = values(container);
    expect(rest).toHaveLength(0);
    expect(only?.tagName).toBe("INPUT");
  });

  it("renders TWO inputs for a number column's `between`", () => {
    const { container } = render(<Leaf columnId="revenue" />);

    expect(options(operatorSelect(container))).toContain("between");
    // The default (`equals`) is a single value; `between` is the shape change.
    expect(values(container)).toHaveLength(1);

    fireEvent.change(operatorSelect(container), {
      target: { value: "between" },
    });

    const [min, max] = values(container);
    expect(values(container)).toHaveLength(2);
    expect(min).toHaveAttribute("aria-label", "Filter minimum");
    expect(max).toHaveAttribute("aria-label", "Filter maximum");

    fireEvent.change(min!, { target: { value: "10" } });
    fireEvent.change(values(container)[1]!, { target: { value: "20" } });
    expect(values(container)[0]).toHaveValue("10");
    expect(values(container)[1]).toHaveValue("20");
  });

  it("renders a multi-select for an enum column's `isAnyOf`", () => {
    const { container, getByLabelText } = render(<Leaf columnId="status" />);

    expect(operatorSelect(container).value).toBe("isAnyOf");
    const [group, ...rest] = values(container);
    expect(rest).toHaveLength(0);
    expect(group).toHaveAttribute("role", "group");

    // Every declared option, labelled the way the column declares it — the
    // bare `won` falls back to its value.
    const boxes = Array.from(
      group!.querySelectorAll<HTMLInputElement>("input[type=checkbox]"),
    );
    expect(boxes).toHaveLength(3);
    expect(group).toHaveTextContent("Open");
    expect(group).toHaveTextContent("won");

    // MULTI-select: two values selected at once is the whole point of the
    // shape, and the cell editors' enum combobox cannot express it.
    fireEvent.click(getByLabelText("Open"));
    fireEvent.click(getByLabelText("Lost"));
    const checked = Array.from(
      container.querySelectorAll<HTMLInputElement>("input[type=checkbox]"),
    ).filter((b) => b.checked);
    expect(checked.map((b) => b.value)).toEqual(["open", "lost"]);
  });

  it("renders NO value control for `isEmpty`", () => {
    const { container } = render(<Leaf />);

    fireEvent.change(operatorSelect(container), {
      target: { value: "isEmpty" },
    });

    expect(operatorSelect(container).value).toBe("isEmpty");
    expect(values(container)).toHaveLength(0);
    expect(container.querySelector("input[type=text]")).toBeNull();
  });

  it("falls back to the new type's default when the operator cannot survive", () => {
    const onChange = vi.fn();
    const { container } = render(<Leaf onChange={onChange} />);

    fireEvent.change(operatorSelect(container), {
      target: { value: "contains" },
    });
    fireEvent.change(values(container)[0]!, { target: { value: "acme" } });
    expect(operatorSelect(container).value).toBe("contains");

    // `contains` is not a number operator; leaving it would name a filter the
    // engine cannot run on this column.
    fireEvent.change(columnSelect(container), { target: { value: "revenue" } });

    expect(columnSelect(container).value).toBe("revenue");
    expect(operatorSelect(container).value).toBe(
      defaultDraft("number").operator,
    );
    expect(options(operatorSelect(container))).toEqual(
      operatorsForType("number"),
    );
    // And the text that meant something under `contains` went with it.
    expect(values(container)[0]).toHaveValue("");
    expect(onChange).toHaveBeenLastCalledWith({
      columnId: "revenue",
      draft: defaultDraft("number"),
    });
  });

  /* The positive twin: a reset that fired on EVERY column change would pass
     the test above while throwing away work the user did. */
  it("keeps an operator the new column can still run", () => {
    const { container } = render(<Leaf />);

    fireEvent.change(operatorSelect(container), {
      target: { value: "endsWith" },
    });
    fireEvent.change(values(container)[0]!, { target: { value: "corp" } });

    fireEvent.change(columnSelect(container), { target: { value: "notes" } });

    expect(columnSelect(container).value).toBe("notes");
    expect(operatorSelect(container).value).toBe("endsWith");
    expect(values(container)[0]).toHaveValue("corp");
  });

  it("marks a hidden column's row, and still shows its value", () => {
    const { container } = render(
      <Leaf columnId="region" draft={{ operator: "contains", text: "east" }} />,
    );

    // The filter still APPLIES — the row says the column is hidden, it does
    // not disable itself.
    expect(row(container)).toHaveAttribute(
      "data-pretable-filter-column-hidden",
      "true",
    );
    expect(values(container)[0]).toHaveValue("east");
    expect(values(container)[0]).toBeEnabled();
    expect(columnSelect(container)).toBeEnabled();

    // Colour is the CSS half and says nothing to a screen reader (SC 1.4.1),
    // so the state is in the picker's name too.
    expect(columnSelect(container).getAttribute("aria-label")).toMatch(
      /hidden/i,
    );

    // A visible column's row carries neither.
    const { container: plain } = render(<Leaf />);
    expect(row(plain)).not.toHaveAttribute(
      "data-pretable-filter-column-hidden",
    );
    expect(columnSelect(plain).getAttribute("aria-label")).not.toMatch(
      /hidden/i,
    );
  });

  /* A leaf seeded from an APPLIED filter — `fromColumnFilter`, which is how
     the section will build every row it did not just add — can carry an
     operator the column's `filterOperators` prunes. `onColumnChange` never
     sees that path. A <select> whose value matches no option displays
     something else, so the row would name a filter it is not applying, and
     the real one would be unreachable (choosing what is already displayed
     fires no change event). `menuOperators` is the module's answer. */
  it("names the applied operator even when the column prunes it", () => {
    const { container } = render(
      <Leaf
        columnId="stage"
        draft={fromColumnFilter("text", { operator: "equals", value: "acme" })}
      />,
    );

    const select = operatorSelect(container);
    // The one assertion that catches the silent substitution: what the select
    // holds and what it DISPLAYS are the same operator.
    expect(select.value).toBe("equals");
    expect(select.options[select.selectedIndex]?.value).toBe("equals");
    expect(options(select)).toContain("equals");
    // Written out, not `toEqual(menuOperators(...))`: comparing the component
    // against the very function it calls passes whenever both are wrong. The
    // permitted pair, plus the applied operator, in the type's own order.
    expect(options(select)).toEqual(["contains", "equals", "isEmpty"]);
    expect(options(select)).not.toContain("notContains");
    // The value the applied filter carried is still on display beside it.
    expect(values(container)[0]).toHaveValue("acme");
  });

  /* The twin: a column that prunes and whose operator IS permitted offers the
     pruned list and nothing more. */
  it("offers only the operators a pruning column permits", () => {
    const { container } = render(<Leaf columnId="stage" />);

    expect(options(operatorSelect(container))).toEqual(["contains", "isEmpty"]);
    expect(operatorSelect(container).value).toBe("contains");
  });

  /* THE SET-SHAPE COLUMN CHANGE. `isAnyOf` is permitted on every enum and
     every boolean column, so the operator check alone lets the whole draft
     through — selection included — and the row then renders a checklist with
     nothing checked while the leaf still holds values from the column the user
     just left. The section would build `isAnyOf ["open"]` on a boolean column:
     a live filter matching nothing, invisible in the UI. It is the defect the
     operator menu's comment argues about, in the value dimension. */
  it("drops a selection the new set-shaped column cannot offer", () => {
    const onChange = vi.fn();
    const { container, getByLabelText } = render(
      <Leaf columnId="status" onChange={onChange} />,
    );

    fireEvent.click(getByLabelText("Open"));
    expect(checkedValues(container)).toEqual(["open"]);

    // Enum -> boolean: `open` is not a value this column has.
    fireEvent.change(columnSelect(container), {
      target: { value: "verified" },
    });

    expect(operatorSelect(container).value).toBe("isAnyOf");
    expect(onChange).toHaveBeenLastCalledWith({
      columnId: "verified",
      draft: defaultDraft("boolean"),
    });
    expect(checkedValues(container)).toEqual([]);
    // And the checklist is the new column's, not a stale one.
    expect(values(container)[0]).toHaveTextContent("True");
    expect(values(container)[0]).toHaveTextContent("False");
  });

  /* The twin, and the reason this is an INTERSECTION rather than a reset: two
     enum columns can overlap, and the part of a selection the new column can
     still offer is work the user did. */
  it("keeps the part of a selection the new column can still offer", () => {
    const onChange = vi.fn();
    const { container, getByLabelText } = render(
      <Leaf columnId="status" onChange={onChange} />,
    );

    fireEvent.click(getByLabelText("Open"));
    fireEvent.click(getByLabelText("won"));
    expect(checkedValues(container)).toEqual(["open", "won"]);

    // `substatus` offers `open` and `blocked` — the overlap is `open` alone.
    fireEvent.change(columnSelect(container), {
      target: { value: "substatus" },
    });

    expect(checkedValues(container)).toEqual(["open"]);
    expect(values(container)[0]).toHaveTextContent("Blocked");
    expect(values(container)[0]).not.toHaveTextContent("won");
    // The LEAF, not just the checkboxes: an unrendered `won` still travels to
    // the engine, and the checklist above cannot see it.
    expect(onChange).toHaveBeenLastCalledWith({
      columnId: "substatus",
      draft: { operator: "isAnyOf", selected: ["open"] },
    });
  });

  /* The one TSDoc claim with no test until now: a boolean COLUMN filters as a
     set over implicit True/False (`resolveColumnOptions`), which is why
     `BooleanCellControl` — a single cell's toggle — is not the control here. */
  it("filters a boolean column as a set over implicit True/False", () => {
    const { container, getByLabelText } = render(<Leaf columnId="verified" />);

    expect(options(operatorSelect(container))).toEqual(
      operatorsForType("boolean"),
    );
    expect(operatorSelect(container).value).toBe("isAnyOf");

    fireEvent.click(getByLabelText("True"));
    fireEvent.click(getByLabelText("False"));
    // Both at once — the set shape, on a type a single toggle cannot express.
    expect(checkedValues(container)).toEqual(["true", "false"]);
  });

  /* A set shape whose choices have not arrived — an enum column with no
     declared `options` and no distinct-value reader. The row cannot tell that
     apart from a column with genuinely no values (its reader is synchronous;
     the section owns the async load), so it says what it can see rather than
     rendering an empty box that explains nothing. */
  it("says so when a set shape has no choices to offer", () => {
    const { container } = render(<Leaf columnId="owner" />);

    const group = values(container)[0]!;
    expect(group).toHaveAttribute("role", "group");
    expect(group.querySelectorAll("input")).toHaveLength(0);
    expect(group).toHaveTextContent(/no values/i);
  });

  /* The choices are resolved for the CHECKLIST, so a shape that renders no
     checklist must not resolve them: the reader is the caller's, it can be a
     scan over loaded rows, and `resolveColumnOptions` can warn about an
     incomplete universe — all for a control that is not on screen. */
  it("does not read distinct values for a shape with no checklist", () => {
    const distinctValues = vi.fn(() => ["ana", "bo"]);
    const { container } = render(
      <Leaf columnId="owner" distinctValues={distinctValues} />,
    );

    // The set shape does read them — the positive half, or the assertion below
    // would pass on a row that never resolves choices at all.
    expect(distinctValues).toHaveBeenCalledWith("owner");
    expect(values(container)[0]).toHaveTextContent("ana");
    distinctValues.mockClear();

    fireEvent.change(operatorSelect(container), {
      target: { value: "isEmpty" },
    });

    expect(values(container)).toHaveLength(0);
    expect(distinctValues).not.toHaveBeenCalled();
  });

  it("names the row it removes, and reports the removal upward", () => {
    const onRemove = vi.fn();
    const { getByRole } = render(
      <Leaf columnId="revenue" onRemove={onRemove} />,
    );

    // Not "Remove": a pane of these is a list of identical buttons otherwise.
    const button = getByRole("button", { name: /revenue/i });
    expect(button).toHaveAttribute("data-pretable-filter-row-remove", "");
    fireEvent.click(button);
    expect(onRemove).toHaveBeenCalledTimes(1);
  });

  /* The join is the RUN's, not the row's (JoinControl's TSDoc argues why), so
     the row takes it as a slot and places it — the CSS's `join · column ·
     operator · value · remove` is one flex box, not a row beside a label. */
  it("places the connective it is given inside its own box", () => {
    const { container } = render(
      <FilterRow
        columns={COLUMNS}
        columnId="name"
        draft={defaultDraft("text")}
        join={<JoinControl first op="and" messages={defaultMessages} />}
        onChange={() => {}}
        onRemove={() => {}}
        messages={defaultMessages}
      />,
    );

    const join = row(container).querySelector("[data-pretable-filter-join]");
    expect(join).toHaveTextContent("Where");
    // First child: the connective is read before the condition it joins.
    expect(row(container).firstElementChild).toBe(join);
  });
});

/**
 * The engine's own view of the same roster `COLUMNS` describes to the chrome.
 *
 * A REAL row model, not a fake handle. Three of this suite's claims are about
 * what the ENGINE does with what the section writes — a new group must not
 * blank the grid, an aborted write must leave the tree alone, and an
 * operand-less leaf must be refused — and none of them can be asserted
 * against a stub that agrees with whatever the section sends it.
 */
interface Deal {
  id: string;
  name: string;
  notes: string;
  revenue: number;
  status: string;
  substatus: string;
  verified: boolean;
  owner: string;
  region: string;
  stage: string;
}

const deal = createColumnHelper<Deal>();
const ENGINE_COLUMNS = [
  deal.accessor("name", { type: "text" }),
  deal.accessor("notes", { type: "text" }),
  deal.accessor("revenue", { type: "number" }),
  deal.accessor("status", { type: "enum" }),
  deal.accessor("substatus", { type: "enum" }),
  deal.accessor("verified", { type: "boolean" }),
  deal.accessor("owner", { type: "enum" }),
  deal.accessor("region", { type: "text" }),
  deal.accessor("stage", { type: "text" }),
] as const;

const DEALS: Deal[] = [
  {
    id: "d1",
    name: "acme corp",
    notes: "east",
    revenue: 10,
    status: "open",
    substatus: "open",
    verified: true,
    owner: "ana",
    region: "east",
    stage: "new",
  },
  {
    id: "d2",
    name: "beta ltd",
    notes: "west",
    revenue: 20,
    status: "won",
    substatus: "blocked",
    verified: false,
    owner: "bo",
    region: "west",
    stage: "new",
  },
  {
    id: "d3",
    name: "acme west",
    notes: "south",
    revenue: 30,
    status: "lost",
    substatus: "open",
    verified: true,
    owner: "ana",
    region: "south",
    stage: "old",
  },
];

const leafNode = (
  columnId: string,
  operator: string,
  value: unknown,
): SurfaceFilterNode =>
  ({ columnId, operator, value }) as unknown as SurfaceFilterNode;

const groupNode = (
  op: "and" | "or",
  children: readonly SurfaceFilterNode[],
): SurfaceFilterNode => ({ op, children }) as SurfaceFilterNode;

describe("FiltersSection", () => {
  /**
   * The section over a live engine: the model IS the grid handle the section
   * subscribes to (`subscribe` + `getState().snapshot.query.filters`), and the
   * write prop is the surface's query path, narrowed to the one axis this
   * section owns.
   */
  function renderSection(
    filters: readonly SurfaceFilterNode[] = [],
    options: {
      readonly columns?: readonly FilterRowColumn[];
      readonly loadDistinctValues?: (columnId: string) => never;
      /** Spread OVER the defaults, so a test overrides only what it names. */
      readonly messages?: Partial<typeof defaultMessages>;
    } = {},
  ) {
    const model = createLocalRowModel({
      rows: DEALS,
      columns: ENGINE_COLUMNS,
      getRowId: (row: Deal) => row.id,
      query: { filters, sort: [], rowGroups: [] } as never,
    });
    const writes = vi.fn<(next: readonly SurfaceFilterNode[]) => void>();
    const view = render(
      <FiltersSection
        grid={model}
        columns={options.columns ?? COLUMNS}
        loadDistinctValues={options.loadDistinctValues}
        setFilters={(next) => {
          writes(next);
          model.setQuery({ filters: next, sort: [], rowGroups: [] } as never);
        }}
        messages={{ ...defaultMessages, ...options.messages }}
      />,
    );
    return {
      ...view,
      model,
      writes,
      /** The tree the ENGINE holds, not the one the section rendered from. */
      tree: () =>
        model.getState().snapshot.query
          .filters as unknown as readonly SurfaceFilterNode[],
      visibleRows: () => model.getState().snapshot.visibleRowCount,
    };
  }

  const filterRows = (scope: HTMLElement) =>
    Array.from(
      scope.querySelectorAll<HTMLElement>("[data-pretable-filter-row]"),
    );
  /** Only the rows of THIS run — a nested rail's rows belong to its own run. */
  const ownRows = (scope: HTMLElement) =>
    Array.from(
      scope.querySelectorAll<HTMLElement>(
        ":scope > [data-pretable-filter-row]",
      ),
    );
  const rails = (scope: HTMLElement) =>
    Array.from(
      scope.querySelectorAll<HTMLElement>("[data-pretable-filter-rail]"),
    );
  /**
   * The connectives of THIS run: one per own row, since the join is a slot
   * INSIDE the row it introduces. A flat query would also collect every
   * nested run's, which is why the JoinControl suite's own helper is scoped
   * away from here.
   */
  const runJoins = (scope: HTMLElement) =>
    ownRows(scope).map((row) =>
      row.querySelector<HTMLElement>("[data-pretable-filter-join]")!,
    );
  const columnOf = (row: HTMLElement) =>
    row.querySelector<HTMLSelectElement>(
      "select[data-pretable-filter-row-column]",
    )!.value;
  const valueOf = (row: HTMLElement) =>
    row.querySelector<HTMLInputElement>(
      "input[data-pretable-filter-row-value]",
    )!;
  const addButtons = (scope: HTMLElement) =>
    Array.from(
      scope.querySelectorAll<HTMLButtonElement>(
        ":scope > * > [data-pretable-filter-add]",
      ),
    );

  it("renders a nested tree in order, with the group's children on a rail", () => {
    const { container } = renderSection([
      leafNode("name", "contains", "acme"),
      groupNode("or", [
        leafNode("revenue", "gt", 15),
        leafNode("notes", "contains", "west"),
      ]),
    ]);

    // Document order is tree order: the root leaf, then the group's two.
    expect(filterRows(container).map(columnOf)).toEqual([
      "name",
      "revenue",
      "notes",
    ]);

    const [rail, ...deeper] = rails(container);
    expect(deeper).toHaveLength(0);
    // The rail holds the GROUP's children and nothing else — the root leaf
    // stays outside it.
    expect(ownRows(rail!).map(columnOf)).toEqual(["revenue", "notes"]);
    expect(ownRows(container).map(columnOf)).toEqual(["name"]);

    // The group's own run reads its own `op`, and it is changeable — unlike
    // the root array's implicit AND, which has no `op` field to write.
    const [first, second] = ownRows(rail!).map((row) =>
      row.querySelector("[data-pretable-filter-join]")!,
    );
    expect(first).toHaveTextContent("Where");
    expect(second).toHaveTextContent("or");
    expect(second!.tagName).toBe("BUTTON");
    const rootJoin = ownRows(container)[0]!.querySelector(
      "[data-pretable-filter-join]",
    )!;
    expect(rootJoin).toHaveTextContent("Where");
  });

  it("says the grid is unfiltered when the tree is empty", () => {
    const { container } = renderSection([]);

    expect(filterRows(container)).toHaveLength(0);
    expect(
      container.querySelector("[data-pretable-filter-empty]"),
    ).toHaveTextContent(/no filters/i);
  });

  /* SP2a's empty-group-TRUE rule, earning its keep: a group is added empty,
     and an empty group that filtered would blank the grid the instant a user
     reached for nesting. */
  it("adds a group without blanking the grid", () => {
    const view = renderSection([leafNode("name", "contains", "acme")]);
    const before = view.visibleRows();
    expect(before).toBe(2);

    fireEvent.click(view.getByRole("button", { name: "+ group" }));

    expect(view.visibleRows()).toBe(before);
    expect(view.tree()).toHaveLength(2);
    expect(view.tree()[1]).toEqual({ op: "and", children: [] });
    // The rail is drawn from the ENGINE's tree and nothing local changed, so
    // this is also the proof that the section's own subscription is live.
    expect(rails(view.container)).toHaveLength(1);
  });

  /* What the engine actually refuses, and — the half that decides the design —
     what it ACCEPTS. An operand-requiring operator with no operand does not
     reach the row model at all; `isEmpty` does, because `validateFilter`
     exempts it and every type's set contains it. That makes it the obvious
     seed for a fresh row and the wrong one: it is a real predicate, and it
     empties the grid on the click that opens the row. Both halves, because
     the choice of an inert group over a seeded operator rests on both. */
  it("refuses an unfinished leaf, and filters with the one it accepts", () => {
    const { model } = renderSection([]);
    const withFilters = (filters: readonly unknown[]) =>
      ({ filters, sort: [], rowGroups: [] }) as never;

    expect(() =>
      model.setQuery(withFilters([{ columnId: "name", operator: "contains" }])),
    ).toThrow(/missing its operand/);

    model.setQuery(withFilters([{ columnId: "name", operator: "isEmpty" }]));
    expect(model.getState().snapshot.visibleRowCount).toBe(0);

    // Which is exactly what the node the section DOES seed must not do.
    model.setQuery(withFilters([{ op: "and", children: [] }]));
    expect(model.getState().snapshot.visibleRowCount).toBe(3);
  });

  /* So `+ filter` opens a row that constrains nothing until it is complete —
     the same inert node an empty group is, which is why the grid does not
     move when one is added. */
  it("opens a filter row that lands only once it has a value", () => {
    vi.useFakeTimers();
    const view = renderSection([]);
    const before = view.visibleRows();

    fireEvent.click(view.getByRole("button", { name: "+ filter" }));

    const [row, ...rest] = filterRows(view.container);
    expect(rest).toHaveLength(0);
    expect(columnOf(row!)).toBe("name");
    expect(view.visibleRows()).toBe(before);

    fireEvent.change(valueOf(row!), { target: { value: "acme" } });
    act(() => {
      vi.advanceTimersByTime(250);
    });

    expect(view.tree()).toEqual([
      { columnId: "name", operator: "contains", value: "acme" },
    ]);
    expect(view.visibleRows()).toBe(2);
  });

  /* The other half of the same rule: emptying a value does not delete the row
     and does not leave the old filter applied — the position goes inert, the
     row stays on screen, and the grid shows everything again. */
  it("keeps an emptied row standing, constraining nothing", () => {
    vi.useFakeTimers();
    const view = renderSection([leafNode("name", "contains", "acme")]);
    expect(view.visibleRows()).toBe(2);

    fireEvent.change(valueOf(filterRows(view.container)[0]!), {
      target: { value: "" },
    });
    act(() => {
      vi.advanceTimersByTime(250);
    });

    expect(view.tree()).toEqual([{ op: "and", children: [] }]);
    expect(view.visibleRows()).toBe(3);
    // Still a row the user can finish, not a rail and not a deletion.
    const [row, ...rest] = filterRows(view.container);
    expect(rest).toHaveLength(0);
    expect(columnOf(row!)).toBe("name");
    expect(valueOf(row!)).toHaveValue("");
    expect(rails(view.container)).toHaveLength(0);
  });

  it("writes a typed value ONCE, after the debounce", () => {
    vi.useFakeTimers();
    const view = renderSection([leafNode("name", "contains", "a")]);
    const row = filterRows(view.container)[0]!;

    for (const value of ["ac", "acm", "acme"]) {
      fireEvent.change(valueOf(row), { target: { value } });
    }
    // Not one write per keystroke — the engine recompiles the whole query on
    // every `setQuery`, and the grid would repaint under the typist.
    expect(view.writes).not.toHaveBeenCalled();

    act(() => {
      vi.advanceTimersByTime(250);
    });

    expect(view.writes).toHaveBeenCalledTimes(1);
    expect(view.tree()).toEqual([
      { columnId: "name", operator: "contains", value: "acme" },
    ]);
  });

  it("applies a discrete change immediately", () => {
    vi.useFakeTimers();
    const view = renderSection([leafNode("name", "contains", "acme")]);
    const row = filterRows(view.container)[0]!;

    fireEvent.change(
      row.querySelector("select[data-pretable-filter-row-operator]")!,
      { target: { value: "isEmpty" } },
    );

    expect(view.writes).toHaveBeenCalledTimes(1);
    expect(view.tree()).toEqual([{ columnId: "name", operator: "isEmpty" }]);
  });

  /* THE ABORT RULE. A position is the only address a node has, and positions
     renumber: the debounced write below was addressed to `[1]` while `[1]`
     was the first `name` row, and by the time the timer fires `[1]` is the
     SECOND one. The neighbour deliberately holds the SAME column — two
     filters on one column is ordinary usage, and a check that only compared
     column ids would wave this write straight onto the wrong row while the
     user's own row kept its old value. Only a full comparison can tell them
     apart. */
  it("aborts a debounced write whose row was renumbered under it", () => {
    vi.useFakeTimers();
    const view = renderSection([
      leafNode("notes", "contains", "west"),
      leafNode("name", "contains", "acme"),
      leafNode("name", "contains", "beta"),
    ]);

    // Start typing in the MIDDLE row...
    fireEvent.change(valueOf(filterRows(view.container)[1]!), {
      target: { value: "ZZZ" },
    });
    // ...then remove the one before it, which slides the second `name` row
    // into `[1]` — the index the pending write is addressed to.
    fireEvent.click(
      view.getByRole("button", { name: /remove filter on notes/i }),
    );
    expect(view.tree()).toHaveLength(2);

    act(() => {
      vi.advanceTimersByTime(250);
    });

    // Nothing anywhere holds `ZZZ`: not the neighbour that inherited the
    // index, and not the row the user was typing into, which no longer sits
    // where the write was addressed.
    expect(view.tree()).toEqual([
      { columnId: "name", operator: "contains", value: "acme" },
      { columnId: "name", operator: "contains", value: "beta" },
    ]);
  });

  /* The same rule at the other door. An unfinished row anchors to an EMPTY
     group, and an empty group is what a populated one looks like if you only
     check that the node is a group — which would let a debounced leaf replace
     a whole subtree the user built. */
  it("aborts rather than overwrite a group that inherited the index", () => {
    vi.useFakeTimers();
    const view = renderSection([
      leafNode("notes", "contains", "west"),
      leafNode("name", "contains", "acme"),
      // `and`, matching the inert node's own operator: a fixture whose group
      // joined with `or` would be told apart by the operator alone, and the
      // emptiness check — the thing under test — would never be reached.
      groupNode("and", [leafNode("revenue", "gt", 15)]),
    ]);

    // Empty the middle row: its position goes inert, and the row now anchors
    // to an empty group rather than to a leaf.
    fireEvent.change(valueOf(filterRows(view.container)[1]!), {
      target: { value: "" },
    });
    act(() => {
      vi.advanceTimersByTime(250);
    });
    expect(view.tree()[1]).toEqual({ op: "and", children: [] });

    // Type it back up, then pull the row above it out from under the write.
    fireEvent.change(valueOf(filterRows(view.container)[1]!), {
      target: { value: "ZZZ" },
    });
    fireEvent.click(
      view.getByRole("button", { name: /remove filter on notes/i }),
    );
    act(() => {
      vi.advanceTimersByTime(250);
    });

    // The group is still a group, with its child intact.
    expect(view.tree()).toEqual([
      { op: "and", children: [] },
      {
        op: "and",
        children: [{ columnId: "revenue", operator: "gt", value: 15 }],
      },
    ]);
  });

  /* The same address problem in the RENDER, and it needs no removal of ours to
     reach: the header funnel writes this very tree, and a commit the section
     never saw renumbers the paths its drafts are keyed by. A draft that
     rendered wherever its key landed would show one row's half-typed value on
     another row — and the next keystroke would commit it there. */
  it("does not show a buffered draft on the row that inherited its index", () => {
    vi.useFakeTimers();
    const view = renderSection([
      leafNode("notes", "contains", "west"),
      leafNode("name", "contains", "acme"),
      leafNode("name", "contains", "beta"),
    ]);

    fireEvent.change(valueOf(filterRows(view.container)[1]!), {
      target: { value: "ZZZ" },
    });
    expect(valueOf(filterRows(view.container)[1]!)).toHaveValue("ZZZ");

    // A commit from somewhere else entirely — the funnel, a controlled query,
    // anything but this section — that drops the first row.
    act(() => {
      view.model.setQuery({
        filters: [
          { columnId: "name", operator: "contains", value: "acme" },
          { columnId: "name", operator: "contains", value: "beta" },
        ],
        sort: [],
        rowGroups: [],
      } as never);
    });

    // Index 1 is now the `beta` row, and it reads `beta`.
    expect(filterRows(view.container).map((row) => valueOf(row).value)).toEqual(
      ["acme", "beta"],
    );

    act(() => {
      vi.advanceTimersByTime(250);
    });

    expect(view.tree()).toEqual([
      { columnId: "name", operator: "contains", value: "acme" },
      { columnId: "name", operator: "contains", value: "beta" },
    ]);
  });

  it("changes one run's join and leaves the other groups alone", () => {
    const view = renderSection([
      groupNode("and", [
        leafNode("name", "contains", "acme"),
        leafNode("notes", "contains", "west"),
      ]),
      groupNode("and", [
        leafNode("revenue", "gt", 15),
        leafNode("stage", "contains", "new"),
      ]),
    ]);

    const [first, second] = rails(view.container);
    const untouched = view.tree()[1];
    fireEvent.click(runJoins(first!)[1]!);

    expect(view.tree()[0]).toEqual({
      op: "or",
      children: [
        { columnId: "name", operator: "contains", value: "acme" },
        { columnId: "notes", operator: "contains", value: "west" },
      ],
    });
    // Identity cannot be asserted here — `compileQuery` re-captures every node
    // on every commit — so the claim is that the OTHER group's content is
    // untouched, which is what a mis-scoped rewrite would break.
    expect(view.tree()[1]).toEqual(untouched);
    expect(runJoins(second!)[1]).toHaveTextContent("and");
  });

  /* A pending write belongs to the row it was typed into, and no other row's
     edit may throw it away. The panel would otherwise go on displaying a
     COMPLETE filter the grid is not applying — permanently, since nothing
     re-commits it — which is the exact divergence this section's design
     promises cannot happen. */
  it("keeps a pending write when another row is edited", () => {
    vi.useFakeTimers();
    const view = renderSection([
      leafNode("name", "contains", "acme"),
      leafNode("notes", "contains", "west"),
    ]);

    fireEvent.change(valueOf(filterRows(view.container)[0]!), {
      target: { value: "ZZZ" },
    });
    // A DISCRETE edit on the other row — it applies at once, and it must
    // settle the write it is taking the timer away from rather than drop it.
    fireEvent.change(
      filterRows(view.container)[1]!.querySelector(
        "select[data-pretable-filter-row-operator]",
      )!,
      { target: { value: "isNotEmpty" } },
    );
    act(() => {
      vi.advanceTimersByTime(500);
    });

    expect(view.tree()).toEqual([
      { columnId: "name", operator: "contains", value: "ZZZ" },
      { columnId: "notes", operator: "isNotEmpty" },
    ]);
    // And the panel agrees with the engine, which is the claim that matters.
    expect(valueOf(filterRows(view.container)[0]!)).toHaveValue("ZZZ");
  });

  /* An abandoned draft anchors to the inert node — and every inert node is
     identical, so the anchor cannot discriminate one from the next. Three
     clicks otherwise turn `+ group` into a filter row. */
  it("does not resurrect an abandoned draft over a new group", () => {
    const view = renderSection([]);

    fireEvent.click(view.getByRole("button", { name: "+ filter" }));
    fireEvent.click(
      view.getByRole("button", { name: /remove filter on name/i }),
    );
    expect(view.tree()).toEqual([]);

    fireEvent.click(view.getByRole("button", { name: "+ group" }));

    // What was asked for: a group, drawn as a rail.
    expect(view.tree()).toEqual([{ op: "and", children: [] }]);
    expect(rails(view.container)).toHaveLength(1);
    expect(filterRows(view.container)).toHaveLength(0);
  });

  /* And the drop the REMOVAL does, which the two tests around it cannot see
     because an insert protects its own slot. Two unfinished rows anchor to
     the same inert node, so when the first is removed the second slides onto
     the first's draft key — and would inherit a value the user typed into a
     row that no longer exists.

     What it becomes instead is an empty rail: the draft is gone, and an inert
     node with no draft is exactly what the tree says it is. That is the same
     wart as reopening the pane on an unfinished row, and the honest reading
     of a position whose draft can no longer be trusted. */
  it("does not slide a removed row's draft onto the row below it", () => {
    vi.useFakeTimers();
    const view = renderSection([
      leafNode("revenue", "equals", 10),
      leafNode("revenue", "equals", 20),
    ]);

    // `1x` and `2x` are not numbers, so both rows go unfinished — and both
    // therefore anchor to the same inert node.
    fireEvent.change(valueOf(filterRows(view.container)[0]!), {
      target: { value: "1x" },
    });
    act(() => {
      vi.advanceTimersByTime(250);
    });
    fireEvent.change(valueOf(filterRows(view.container)[1]!), {
      target: { value: "2x" },
    });
    act(() => {
      vi.advanceTimersByTime(250);
    });
    expect(view.tree()).toEqual([
      { op: "and", children: [] },
      { op: "and", children: [] },
    ]);
    expect(filterRows(view.container).map((row) => valueOf(row).value)).toEqual(
      ["1x", "2x"],
    );

    fireEvent.click(
      view.getAllByRole("button", { name: /remove filter on revenue/i })[0]!,
    );

    expect(view.tree()).toEqual([{ op: "and", children: [] }]);
    expect(filterRows(view.container)).toHaveLength(0);
    expect(rails(view.container)).toHaveLength(1);
  });

  /* The same resurrection, reached WITHOUT a removal of ours — a funnel
     "clear all", a controlled query, any commit this section did not make.
     The three clicks above are fixed by the drop the removal does; this is
     what pins the drop the INSERT does, and the two are the same rule. */
  it("does not resurrect a draft the section never saw removed", () => {
    const view = renderSection([]);

    fireEvent.click(view.getByRole("button", { name: "+ filter" }));
    expect(filterRows(view.container)).toHaveLength(1);

    act(() => {
      view.model.setQuery({
        filters: [],
        sort: [],
        rowGroups: [],
      } as never);
    });

    fireEvent.click(view.getByRole("button", { name: "+ group" }));

    expect(view.tree()).toEqual([{ op: "and", children: [] }]);
    expect(rails(view.container)).toHaveLength(1);
    expect(filterRows(view.container)).toHaveLength(0);
  });

  /* Two empty groups differ only by their operator, so that is the only thing
     that can keep a row anchored to an inert `and` off an `or` the engine
     received from somewhere else. Pinned in both directions: the write does
     not land, and the group does not draw as a row. */
  it("does not treat an empty `or` as the empty `and` a row anchored to", () => {
    vi.useFakeTimers();
    const view = renderSection([
      leafNode("notes", "contains", "west"),
      leafNode("name", "contains", "acme"),
    ]);

    fireEvent.change(valueOf(filterRows(view.container)[1]!), {
      target: { value: "" },
    });
    act(() => {
      vi.advanceTimersByTime(250);
    });
    expect(view.tree()[1]).toEqual({ op: "and", children: [] });

    fireEvent.change(valueOf(filterRows(view.container)[1]!), {
      target: { value: "ZZZ" },
    });
    act(() => {
      view.model.setQuery({
        filters: [
          { columnId: "notes", operator: "contains", value: "west" },
          { op: "or", children: [] },
        ],
        sort: [],
        rowGroups: [],
      } as never);
    });
    act(() => {
      vi.advanceTimersByTime(250);
    });

    expect(view.tree()[1]).toEqual({ op: "or", children: [] });
    expect(rails(view.container)).toHaveLength(1);
    expect(filterRows(view.container)).toHaveLength(1);
  });

  it("refuses to add a row when there is no column to filter on", () => {
    const view = renderSection([], { columns: [] });

    const add = view.getByRole("button", { name: "+ filter" });
    expect(add).toBeDisabled();
    expect(
      view.container.querySelector(`#${add.getAttribute("aria-describedby")!}`),
    ).toHaveTextContent(/no columns/i);
    // Nesting is still fine — the two refusals are independent.
    expect(view.getByRole("button", { name: "+ group" })).toBeEnabled();
  });

  /**
   * A loader in the surface's shape — `{ status, finished, cancel }` — whose
   * promise this suite settles by hand. The seam under test is precisely that
   * the row reads choices SYNCHRONOUSLY while the surface answers with a
   * query, so a loader that resolved immediately would test neither half.
   */
  function deferredLoader() {
    const calls: string[] = [];
    const cancel = vi.fn();
    let settle!: (values: readonly string[]) => void;
    let fail!: (reason: unknown) => void;
    const load = (columnId: string) => {
      calls.push(columnId);
      return {
        status: "pending",
        finished: new Promise((resolve, reject) => {
          settle = (values) =>
            resolve({ values: values.map((value) => ({ value })) });
          fail = reject;
        }),
        cancel,
      } as never;
    };
    return {
      load,
      calls,
      cancel,
      settle: (values: readonly string[]) => settle(values),
      fail: (reason: unknown) => fail(reason),
    };
  }

  /* `owner` is an enum column that declares no options, so its checklist can
     only come from the engine — asynchronously, through a loader the row
     itself cannot call. */
  it("loads an enum column's choices and hands the row a sync reader", async () => {
    const loader = deferredLoader();
    const view = renderSection([leafNode("owner", "isAnyOf", ["ana"])], {
      loadDistinctValues: loader.load,
    });

    expect(loader.calls).toEqual(["owner"]);
    // Until it answers the row can only say what it can see.
    expect(values(view.container)[0]).toHaveTextContent(/no values/i);

    await act(async () => {
      loader.settle(["ana", "bo"]);
    });

    expect(values(view.container)[0]).toHaveTextContent("ana");
    expect(values(view.container)[0]).toHaveTextContent("bo");
    // The applied filter is checked against the choices that just arrived.
    expect(checkedValues(view.container)).toEqual(["ana"]);
  });

  it("cancels a load still in flight when the pane closes", () => {
    const loader = deferredLoader();
    const view = renderSection([leafNode("owner", "isAnyOf", ["ana"])], {
      loadDistinctValues: loader.load,
    });
    expect(loader.cancel).not.toHaveBeenCalled();

    view.unmount();

    expect(loader.cancel).toHaveBeenCalledTimes(1);
  });

  it("records an answered load, failure included, and does not re-ask", async () => {
    const loader = deferredLoader();
    // `status` stripped of its declared options, so this roster holds TWO
    // columns whose choices can only come from the loader — which is what
    // makes the wanted set able to CHANGE, and the re-ask visible.
    const roster = COLUMNS.map((column) =>
      column.id === "status" ? { ...column, options: undefined } : column,
    );
    const view = renderSection(
      [
        leafNode("owner", "isAnyOf", ["ana"]),
        leafNode("status", "isEmpty", undefined),
      ],
      { loadDistinctValues: loader.load, columns: roster },
    );

    expect(loader.calls).toEqual(["owner"]);
    await act(async () => {
      loader.fail(new Error("no"));
    });
    // A failed load and an empty column are the same thing to the row — the
    // documented cost of a synchronous reader over an async source.
    expect(values(view.container)[0]).toHaveTextContent(/no values/i);

    // Now the wanted SET changes, which is the only thing that re-runs the
    // load: the second row starts showing a checklist.
    fireEvent.change(
      filterRows(view.container)[1]!.querySelector(
        "select[data-pretable-filter-row-operator]",
      )!,
      { target: { value: "isAnyOf" } },
    );

    // The new column is asked. The one that already answered is not.
    expect(loader.calls).toEqual(["owner", "status"]);
  });

  /* The set of wanted columns is derived from what the rows READ, so a shape
     with no checklist asks for nothing — the loader is the surface's, it can
     scan the loaded rows, and it can warn about an incomplete universe. */
  it("asks for no choices when no row is showing a checklist", () => {
    const loader = deferredLoader();
    renderSection([leafNode("owner", "isNotEmpty", undefined)], {
      loadDistinctValues: loader.load,
    });

    expect(loader.calls).toEqual([]);
  });

  /* The engine refuses a tree nested deeper than 64 by throwing
     `invalid-query` out of `setQuery`, which no consumer catches — so the
     action that would build one refuses first, and says why. Both halves in
     one fixture: the deepest group's `+ group` would land at 65 and is
     refused; its parent's would land at 64 and is offered. */
  it("refuses `+ group` at the nesting bound and offers it one level up", () => {
    let deepest: SurfaceFilterNode = groupNode("and", []);
    for (let depth = 0; depth < 64; depth += 1) {
      deepest = groupNode("and", [deepest]);
    }
    const view = renderSection([deepest]);

    const allRails = rails(view.container);
    expect(allRails).toHaveLength(65);
    const bottom = allRails[64]!;
    const above = allRails[63]!;

    const refused = addButtons(bottom).find((button) =>
      button.textContent?.includes("group"),
    )!;
    expect(refused).toBeDisabled();
    expect(refused.getAttribute("title")).toMatch(/64/);
    // The title is the pointer's convenience; a disabled button cannot be
    // focused, so the REASON has to be on the page. Both buttons of a refused
    // run point at the one rendered explanation.
    const describedBy = refused.getAttribute("aria-describedby")!;
    const reason = bottom.querySelector(`#${describedBy}`);
    expect(reason).toHaveTextContent(/cannot nest deeper than 64/i);
    const refusedFilter = addButtons(bottom).find((button) =>
      button.textContent?.includes("filter"),
    )!;
    expect(refusedFilter).toBeDisabled();
    expect(refusedFilter.getAttribute("aria-describedby")).toBe(describedBy);

    const offered = addButtons(above).find((button) =>
      button.textContent?.includes("group"),
    )!;
    expect(offered).toBeEnabled();
  });

  /* The refusal's identity is the REASON, not its wording. Both messages are
     overridden to ONE string here — legal now that they are overridable at
     all, and the case that stops the section deciding which explanation a
     button points at by comparing text.

     Honest about its reach: this does NOT distinguish the discriminant from
     the text comparison it replaced. Measured, not assumed — reverting to the
     comparison leaves it passing, because `groupReason` is only ever `tooDeep`
     and `filterReason` falls back to it, so the two are never two DIFFERENT
     non-null reasons at once; the id is computed from the same value for both
     the button and the span, and they cannot disagree. The discriminant is
     therefore a clarity fix, not a bug fix, and what this pins is the
     RENDERED contract under a collision: exactly one explanation, and every
     refused button resolving to it. That much it does catch — dropping the
     dedupe renders two spans sharing an id and fails here. */
  it("keys a refusal by its reason even when both refusals read identically", () => {
    let deepest: SurfaceFilterNode = groupNode("and", []);
    for (let depth = 0; depth < 64; depth += 1) {
      deepest = groupNode("and", [deepest]);
    }
    const view = renderSection([deepest], {
      messages: {
        toolPanelFilterDepthRefusal: () => "SAME",
        toolPanelNoFilterColumnsRefusal: () => "SAME",
      },
    });

    const bottom = rails(view.container)[64]!;
    const buttons = addButtons(bottom);
    expect(buttons).toHaveLength(2);
    for (const button of buttons) {
      expect(button).toBeDisabled();
      expect(button.getAttribute("title")).toBe("SAME");
    }
    // One rendered explanation, and BOTH buttons resolve to it. Two ids for
    // one reason would leave one button describing an element that is not
    // there.
    const ids = new Set(
      buttons.map((button) => button.getAttribute("aria-describedby")),
    );
    expect(ids.size).toBe(1);
    const id = [...ids][0]!;
    expect(bottom.querySelector(`#${id}`)).toHaveTextContent("SAME");
    expect(bottom.querySelectorAll(":scope > * > [id]")).toHaveLength(1);
  });
});
