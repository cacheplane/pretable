import type { PasteSummary } from "../qty-paste";
import type { SelectionSummary } from "../selection";
import styles from "./sidebar.module.css";

const plural = (n: number, noun: string): string =>
  `${n} ${noun}${n === 1 ? "" : "s"}`;

export interface SelectionSectionProps {
  summary: SelectionSummary | null;
  copied: boolean;
  paste?: PasteSummary | null;
}

export function SelectionSection({
  summary,
  copied,
  paste = null,
}: SelectionSectionProps) {
  if (!summary && !paste) return null;
  return (
    <section className={styles.section} aria-label="Selection">
      <span className={styles.label}>Selection</span>
      {summary && (
        <span className={styles.selsum}>
          {summary.rows} × {summary.cols} selected · ⌘C to copy
          {copied && <span className={styles.copied}> · Copied ✓</span>}
        </span>
      )}
      {paste && (
        <span className={styles.selsum} data-testid="paste-summary">
          Pasted {paste.applied} of {paste.total}
          {paste.rejected > 0 && ` · ${paste.rejected} rejected`}
          {paste.clippedRows > 0 &&
            ` · ${plural(paste.clippedRows, "row")} past the end`}
          {paste.clippedColumns > 0 &&
            ` · ${plural(paste.clippedColumns, "column")} past the last column`}
        </span>
      )}
    </section>
  );
}
