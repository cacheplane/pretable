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

interface OnCourseRow {
  id: string;
  bib: number | "—";
  gateFilled: [boolean, boolean, boolean, boolean];
}

interface Counters {
  finished: number;
  dnf: number;
}

const MAX_ON_COURSE = 5;

interface ScoreboardModel {
  leader: Leader | null;
  onCourse: OnCourseRow[];
  onCourseOverflow: number;
  counters: Counters;
}

function gateFilled(row: RaceRow): [boolean, boolean, boolean, boolean] {
  return [row.gate1 !== "", row.gate2 !== "", row.gate3 !== "", row.finish !== ""];
}

function compareRunning(a: RaceRow, b: RaceRow): number {
  const af = gateFilled(a).filter(Boolean).length;
  const bf = gateFilled(b).filter(Boolean).length;
  if (af !== bf) return bf - af;
  const aBib = typeof a.bib === "number" ? a.bib : Number.POSITIVE_INFINITY;
  const bBib = typeof b.bib === "number" ? b.bib : Number.POSITIVE_INFINITY;
  return aBib - bBib;
}

function buildModel(rows: readonly RaceRow[]): ScoreboardModel {
  const racing = rows.filter((r) => !r.id.startsWith("tel-"));
  const leaderRow = racing.find((r) => r.delta === "LEADER");
  const leader = leaderRow
    ? { bib: leaderRow.bib, racer: leaderRow.racer, finish: leaderRow.finish }
    : null;

  const running = racing.filter((r) => r.status === "running");
  running.sort(compareRunning);
  const onCourse = running.slice(0, MAX_ON_COURSE).map((r) => ({
    id: r.id,
    bib: r.bib,
    gateFilled: gateFilled(r),
  }));
  const onCourseOverflow = Math.max(0, running.length - MAX_ON_COURSE);

  const counters: Counters = {
    finished: racing.filter((r) => r.status === "finished").length,
    dnf: racing.filter((r) => r.status === "DNF" || r.status === "DSQ").length,
  };

  return { leader, onCourse, onCourseOverflow, counters };
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

      {model.onCourse.length > 0 && (
        <section className={styles.section} data-testid="scoreboard-on-course">
          <div className={styles.label}>ON COURSE</div>
          {model.onCourse.map((r) => (
            <div
              className={styles.racerLine}
              data-testid="scoreboard-racer"
              key={r.id}
            >
              <span className={styles.bib}>#{r.bib}</span>
              <span className={styles.dots}>
                {r.gateFilled.map((filled, i) => (
                  <span
                    className={styles.dot}
                    data-filled={filled ? "true" : "false"}
                    data-testid="gate-dot"
                    key={i}
                  >
                    {filled ? "●" : "○"}
                  </span>
                ))}
              </span>
            </div>
          ))}
          {model.onCourseOverflow > 0 && (
            <div className={styles.overflow} data-testid="scoreboard-overflow">
              +{model.onCourseOverflow} more
            </div>
          )}
        </section>
      )}

      {(model.counters.finished > 0 || model.counters.dnf > 0) && (
        <section className={styles.counters} data-testid="scoreboard-counters">
          {model.counters.finished > 0 && (
            <span>FIN {model.counters.finished}</span>
          )}
          {model.counters.dnf > 0 && <span>DNF {model.counters.dnf}</span>}
        </section>
      )}
    </aside>
  );
}
