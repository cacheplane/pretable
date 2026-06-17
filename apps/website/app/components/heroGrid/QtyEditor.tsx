import type { PretableEditorInput } from "@pretable/react";
import type { PositionRow } from "./types";
import styles from "./qtyEditor.module.css";

export function QtyEditor({
  input,
}: {
  input: PretableEditorInput<PositionRow>;
}) {
  const { status, error } = input;
  const pending = status === "validating" || status === "saving";

  return (
    <span className={styles.wrap}>
      <input
        aria-label="Edit quantity"
        className={styles.input}
        autoFocus
        value={String(input.draft ?? "")}
        onChange={(e) => input.setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            input.commit("down");
          } else if (e.key === "Escape") {
            e.preventDefault();
            input.cancel();
          }
        }}
      />
      {status === "validating" && (
        <span className={`${styles.icon} ${styles.pending}`} aria-hidden="true">
          ⟳
        </span>
      )}
      {pending && (
        <span className={styles.popover} role="status">
          <span
            className={`${styles.icon} ${styles.pending} ${styles.spin}`}
            aria-hidden="true"
          >
            ⟳
          </span>
          {status === "validating" ? "compliance check…" : "submitting order…"}
        </span>
      )}
      {!pending && error && (
        <span className={`${styles.popover} ${styles.error}`} role="alert">
          {error}
        </span>
      )}
    </span>
  );
}
