import { SECTORS } from "../filters";
import styles from "./sidebar.module.css";

export interface FilterSectionProps {
  search: string;
  sector: string;
  onSearch: (value: string) => void;
  onSector: (value: string) => void;
}

export function FilterSection({ search, sector, onSearch, onSector }: FilterSectionProps) {
  return (
    <section className={styles.section} aria-label="Filters">
      <span className={styles.label}>Filter</span>
      <input
        className={styles.search}
        placeholder="Filter symbol or name…"
        value={search}
        onChange={(e) => onSearch(e.target.value)}
      />
      <div className={styles.chips} role="group" aria-label="Sector">
        {SECTORS.map((s) => (
          <button
            key={s}
            type="button"
            className={styles.chip}
            aria-pressed={sector === s}
            onClick={() => onSector(s)}
          >
            {s}
          </button>
        ))}
      </div>
    </section>
  );
}
