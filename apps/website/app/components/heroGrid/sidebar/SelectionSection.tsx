import type { SelectionSummary } from "../selection";
import styles from "./sidebar.module.css";

export interface SelectionSectionProps {
  summary: SelectionSummary | null;
  copied: boolean;
}

export function SelectionSection({ summary, copied }: SelectionSectionProps) {
  if (!summary) return null;
  return (
    <section className={styles.section} aria-label="Selection">
      <span className={styles.label}>Selection</span>
      <span className={styles.selsum}>
        {summary.rows} × {summary.cols} selected · ⌘C to copy
        {copied && <span className={styles.copied}> · Copied ✓</span>}
      </span>
    </section>
  );
}
