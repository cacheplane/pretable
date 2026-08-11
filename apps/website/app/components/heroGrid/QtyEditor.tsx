import styles from "./qtyEditor.module.css";

interface QtyEditorInput {
  readonly status: "checking" | "editing" | "validating" | "saving" | "error";
  readonly error?: string;
  readonly draft: number | string;
  readonly setDraft: (value: number | string) => void;
  readonly commit: (direction?: "up" | "down" | "left" | "right") => void;
  readonly cancel: () => void;
}

export function QtyEditor({ input }: { input: QtyEditorInput }) {
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
