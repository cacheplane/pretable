import { createElement } from "react";

import type { PretableEditorInput } from "../types";
import { useEditorField } from "./use-editor-field";

function stepDraft(draft: unknown, step: number, dir: 1 | -1): string {
  const n = Number(String(draft ?? "").trim());
  const base = Number.isNaN(n) ? 0 : n;
  // Round to the step's decimal places to dodge float drift (0.1+0.2).
  const decimals = (String(step).split(".")[1] ?? "").length;
  return (base + dir * step).toFixed(decimals);
}

export function NumberCellEditor({ input }: { input: PretableEditorInput }) {
  const { ref, pending, fieldProps } = useEditorField<HTMLInputElement>(input);
  const step = input.column.step ?? 1;
  const bump = (dir: 1 | -1) => {
    if (!pending) input.setDraft(stepDraft(input.draft, step, dir));
  };

  return (
    <span data-pretable-number-editor="">
      <input
        ref={ref}
        className="pretable-cell-editor"
        inputMode="decimal"
        value={String(input.draft ?? "")}
        onChange={(e) => input.setDraft(e.target.value)}
        {...fieldProps}
        onKeyDown={(e) => {
          if (e.key === "ArrowUp" || e.key === "ArrowDown") {
            e.preventDefault();
            e.stopPropagation();
            bump(e.key === "ArrowUp" ? 1 : -1);
            return;
          }
          fieldProps.onKeyDown(e);
        }}
      />
      {/* keep focus in the input; a focused stepper would blur-commit the edit */}
      {/* The one place that stays Unicode rather than using the icon set. These
          two buttons are dimensioned around an 8px text glyph (`font-size: 8px`
          in a `padding: 2px 4px` box in grid.css), and a stacked pair of them
          has to fit inside a cell-height editor. Swapping in chevrons at 10px —
          the smallest size at which the set's 1.5 stroke still reads — was
          measured: the stepper column went 14.36px -> 18px, the editor box
          22px -> 19px, and the buttons overflowed their container by 9px
          instead of 2px. Shrinking the glyph to ~6px to hold the geometry puts
          its scaled stroke under 1px, which is a hairline, not a member of this
          set. So the column would have to be redesigned first; that is a sizing
          decision, not a glyph swap. */}
      <span
        data-pretable-number-steppers=""
        onMouseDown={(e) => e.preventDefault()}
      >
        <button
          type="button"
          tabIndex={-1}
          aria-label="Increment"
          onClick={() => bump(1)}
        >
          ▲
        </button>
        <button
          type="button"
          tabIndex={-1}
          aria-label="Decrement"
          onClick={() => bump(-1)}
        >
          ▼
        </button>
      </span>
    </span>
  );
}
