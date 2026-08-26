import type { SurfaceFilterGroup } from "../../filter-tree";

/** The other join. Two values, so the control sets rather than cycles. */
const other = (op: SurfaceFilterGroup["op"]): SurfaceFilterGroup["op"] =>
  op === "and" ? "or" : "and";

const JOIN_LABELS: Record<SurfaceFilterGroup["op"], string> = {
  and: "and",
  or: "or",
};

/**
 * The connective between two rows of a sibling run: `Where`, then `and`/`or`.
 *
 * ## Why it sits between the rows
 *
 * The connective is the thing users misread, so the builder shows it where
 * the reading happens instead of hiding it in a group header. The first row
 * of a run has nothing before it to join to, so it takes a plain `Where`
 * label; every later row takes a button carrying the run's join.
 *
 * ## One run, one join
 *
 * A sibling list has exactly ONE `op` in the engine — `{ op, children }`, not
 * an op per child. So this control does not own its value: it renders the
 * `op` its run was given and reports the other one upward, and the section
 * rewrites the whole run. Rows 2 and 3 of a run therefore always read the
 * same thing, and clicking either changes both. Holding the value locally
 * would render a lie the first time a user clicked the second control.
 *
 * That is also why the accessible name says "all conditions in this list"
 * rather than naming the row: the label has to promise the run-wide effect
 * BEFORE the click, since a screen-reader user cannot see the sibling above
 * change with it.
 *
 * ## The name ADDS the promise to the value, it does not replace it
 *
 * `and, join all conditions in this list with or` — the current join first,
 * then what a press would do. Naming only the press was a Level A failure on
 * two counts, and `ColumnPinMenu` (whose voice this follows) is not a
 * precedent for it: its items carry NO aria-label, so their visible text IS
 * their accessible name. Copying the voice without that mechanism broke
 * both rules the mechanism was holding up.
 *
 * SC 2.5.3 Label in Name: `and` is the only text on the control, so it is
 * the visible label — and a name that said only "…with or" did not contain
 * it. A Voice Control user reads `and` off the screen, says "click and", and
 * hits nothing.
 *
 * SC 4.1.2 Name, Role, Value: the control looks like a select — bordered,
 * `space-between`, a caret — with its value on display, and none of that
 * value reached the accessibility tree. A screen-reader user heard "…with
 * or, button" and could not tell what the run currently was.
 *
 * ## Not `aria-pressed`
 *
 * The button sets a value, it does not toggle itself on and off — the same
 * distinction that makes `ColumnPinMenu`'s items read `Pin left` / `Unpin`
 * (what will happen) rather than a pressed state. `aria-pressed` here would
 * announce a state that does not exist alongside a name that already says
 * what the press does.
 *
 * Presentational by design: no state, no effects, no subscription, and no
 * knowledge of paths or the tree. The section owns all of that.
 */
export function JoinControl({
  index,
  op,
  onChange,
}: {
  /**
   * The row's position within its sibling run. `0` renders the
   * non-interactive `Where`; the `op` still comes in, because a run hands
   * every one of its rows the same props.
   */
  index: number;
  /** The run's join, not this row's — there is no such thing. */
  op: SurfaceFilterGroup["op"];
  /** Called with the OTHER join; the caller rewrites the whole run. */
  onChange: (op: SurfaceFilterGroup["op"]) => void;
}) {
  // Both shapes carry `data-pretable-filter-join`: it holds the shared box
  // (24px tall, 44px wide) that keeps the rows below the first lined up with
  // the one above. Only the button matches the stylesheet's
  // `button[data-pretable-filter-join]` rule, which adds the border, the
  // padding and the pointer.
  if (index === 0) {
    return <span data-pretable-filter-join="">Where</span>;
  }

  const next = other(op);
  return (
    <button
      type="button"
      data-pretable-filter-join=""
      aria-label={`${JOIN_LABELS[op]}, join all conditions in this list with ${JOIN_LABELS[next]}`}
      onClick={() => onChange(next)}
    >
      <span>{JOIN_LABELS[op]}</span>
      {/* Decorative, and hidden from the name the label above already gives:
          the glyph is the affordance that this word is editable at all. The
          stylesheet's `justify-content: space-between` is sized for exactly
          these two children. */}
      <span aria-hidden="true">▾</span>
    </button>
  );
}
