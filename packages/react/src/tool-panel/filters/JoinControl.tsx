import { createElement } from "react";

import type { SurfaceFilterGroup } from "../../filter-tree";
import type { JoinControlMessages } from "../messages";

type Join = SurfaceFilterGroup["op"];

const other = (op: Join): Join => (op === "and" ? "or" : "and");

/**
 * The connective between two rows of a sibling run: `Where`, then `and`/`or`.
 *
 * ## Why it sits between the rows
 *
 * The connective is the thing users misread, so the builder shows it where
 * the reading happens instead of hiding it in a group header. The run's
 * first row has nothing before it to join to, so it takes a plain `Where`
 * label; every later row carries the run's join.
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
 * ## A run whose join is FIXED: omit `onChange`
 *
 * The tree's top level is a bare array — an implicit AND with no `op` field
 * at all; only a nested `SurfaceFilterGroup` has one to set. So the root run
 * has a join to SHOW and nothing to change, and it says so by passing no
 * `onChange`: the word renders in the same non-interactive shape `Where`
 * takes.
 *
 * The alternative — a button wired to a no-op — is the defect this seam
 * exists to prevent. It would look live, take focus, announce "join all
 * conditions in this list with or", and do nothing: a promise to a
 * screen-reader user that the control cannot keep. A control that cannot act
 * must not present as one.
 *
 * ## The name ADDS the promise to the value, it does not replace it
 *
 * `and, join all conditions in this list with or` — the current join first,
 * then what a press would do. Naming only the press fails SC 2.5.3 Label in
 * Name (Level A): `and` is the only text on the control, so it IS the
 * visible label, and a name that said just "…with or" did not contain it. A
 * Voice Control user reads `and` off the screen, says "click and", and hits
 * nothing.
 *
 * Leading with the value also serves SC 4.1.2's intent, though as a
 * workaround rather than as remediation of a defined failure: the control
 * LOOKS like a select — bordered, a caret, its value on display — but a
 * `<button>` has no ARIA value property to carry that value (the same fact
 * that rules out `aria-pressed` below), so the name is the only slot left.
 * Without it the accessibility tree simply omits what every sighted user can
 * read, and a screen-reader user cannot tell what the run currently is.
 *
 * `ColumnRowMenu`, whose voice this follows, is safe from all of the above by
 * MECHANISM, not by wording: its items carry no `aria-label` at all, so their
 * visible text is their accessible name and cannot drift from it.
 *
 * ## Not `aria-pressed`
 *
 * The button sets a value, it does not toggle itself on and off — the same
 * distinction that makes `ColumnRowMenu`'s items read `Pin left` / `Unpin`
 * (what will happen) rather than a pressed state. `aria-pressed` here would
 * announce a state that does not exist alongside a name that already says
 * what the press does.
 *
 * ## Where the words come from
 *
 * All three — `Where`, the join word, and the action sentence — are surface
 * messages, resolved by the caller. The `JOIN_LABELS` record that used to sit
 * at the top of this file was ceremony at runtime (its values equalled its
 * keys) and said so: it existed only to hold the i18n seam open. The seam is
 * real now, so it is gone — `toolPanelFilterJoinLabel({ op })` IS the lookup,
 * and one fewer indirection stands between `op` and the word on screen.
 *
 * The action sentence takes both the raw joins and the rendered words. A
 * localizer can build the sentence from `op`/`next` in any word order; the
 * default uses `opLabel`/`nextLabel` so that overriding only the join word
 * still leaves the accessible name containing the control's visible text —
 * the SC 2.5.3 obligation argued above, kept by construction rather than by
 * asking an overrider to remember it.
 *
 * Presentational by design: no state, no effects, no subscription, and no
 * knowledge of paths or the tree. The section owns all of that.
 */
export function JoinControl({
  first,
  op,
  onChange,
  messages,
}: {
  /**
   * Is this the run's first row? It takes `Where`, having nothing before it
   * to join to. Stated as its own flag because that is the whole question
   * this component asks — a row index would carry more meaning than the body
   * reads.
   */
  first: boolean;
  /** The run's join, not this row's — there is no such thing. */
  op: Join;
  /**
   * Called with the OTHER join; the caller rewrites the whole run. ABSENT
   * when the run's join cannot be changed (the root array's implicit AND),
   * which renders the word without an affordance to change it.
   */
  onChange?: (op: Join) => void;
  /** Resolved surface messages — this component defaults no string itself. */
  messages: JoinControlMessages;
}) {
  const joinLabel = messages.toolPanelFilterJoinLabel({ op });

  // Both shapes carry `data-pretable-filter-join`: it holds the shared box
  // (24px tall, at least 44px wide) that keeps the rows below the first lined
  // up with the one above. Only the button also matches the stylesheet's
  // `button[data-pretable-filter-join]` rule, which adds the border, the
  // padding and the pointer.
  if (first || !onChange) {
    return (
      <span data-pretable-filter-join="">
        {first ? messages.toolPanelFilterWhereLabel() : joinLabel}
      </span>
    );
  }

  const next = other(op);

  return (
    <button
      type="button"
      data-pretable-filter-join=""
      aria-label={messages.toolPanelFilterJoinActionLabel({
        op,
        next,
        opLabel: joinLabel,
        nextLabel: messages.toolPanelFilterJoinLabel({ op: next }),
      })}
      onClick={() => onChange(next)}
    >
      <span>{joinLabel}</span>
      {/* Decorative, and hidden from the name the label above already gives:
          the glyph is the affordance that this word is editable at all. The
          stylesheet's `justify-content: space-between` assumes exactly these
          two children — it pushes the word and the caret to opposite edges. */}
      <span aria-hidden="true">▾</span>
    </button>
  );
}
