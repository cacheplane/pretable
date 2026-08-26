// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { SurfaceFilterGroup } from "../filter-tree";
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
import { JoinControl } from "../tool-panel/filters/JoinControl";

afterEach(() => {
  cleanup();
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
        join={<JoinControl first op="and" />}
        onChange={() => {}}
        onRemove={() => {}}
      />,
    );

    const join = row(container).querySelector("[data-pretable-filter-join]");
    expect(join).toHaveTextContent("Where");
    // First child: the connective is read before the condition it joins.
    expect(row(container).firstElementChild).toBe(join);
  });
});
