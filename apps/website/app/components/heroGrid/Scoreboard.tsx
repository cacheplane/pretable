import { useMemo } from "react";

import type { RaceRow } from "./types";
import styles from "./scoreboard.module.css";

export interface ScoreboardProps {
  rows: readonly RaceRow[];
}

interface Leader {
  bib: number | "—";
  racer: string;
  finish: string;
}

interface ScoreboardModel {
  leader: Leader | null;
}

function buildModel(rows: readonly RaceRow[]): ScoreboardModel {
  const racing = rows.filter((r) => !r.id.startsWith("tel-"));
  const leaderRow = racing.find((r) => r.delta === "LEADER");
  const leader = leaderRow
    ? {
        bib: leaderRow.bib,
        racer: leaderRow.racer,
        finish: leaderRow.finish,
      }
    : null;
  return { leader };
}

export function Scoreboard({ rows }: ScoreboardProps) {
  const model = useMemo(() => buildModel(rows), [rows]);

  return (
    <aside aria-label="Race scoreboard" className={styles.board}>
      {model.leader && (
        <section className={styles.section} data-testid="scoreboard-leader">
          <div className={styles.label}>LEADER</div>
          <div className={styles.time}>{model.leader.finish}</div>
          <div className={styles.racer}>
            #{model.leader.bib} {model.leader.racer}
          </div>
        </section>
      )}
    </aside>
  );
}
