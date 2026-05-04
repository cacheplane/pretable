import type { RaceRow } from "./types";

interface CourseVisualizationProps {
  rows: RaceRow[];
}

const VIEWBOX_W = 100;
const VIEWBOX_H = 600;

const GATES = [
  { id: "G1", y: 120 },
  { id: "G2", y: 240 },
  { id: "G3", y: 360 },
  { id: "G4", y: 460 },
  { id: "FIN", y: 560 },
] as const;

const START_Y = 40;

function computeRacerY(row: RaceRow): number {
  // Position the dot inside the bracket of the most-recent crossed gate.
  if (row.gate3) return interpolate(GATES[2].y, GATES[4].y);
  if (row.gate2) return interpolate(GATES[1].y, GATES[2].y);
  if (row.gate1) return interpolate(GATES[0].y, GATES[1].y);
  return interpolate(START_Y, GATES[0].y);
}

function interpolate(top: number, bottom: number): number {
  return (top + bottom) / 2;
}

function dotColor(bib: number | "—"): string {
  if (bib === "—") return "#9ca3af";
  // Deterministic palette from bib number.
  const palette = [
    "#dc2626",
    "#ea580c",
    "#ca8a04",
    "#16a34a",
    "#0891b2",
    "#2563eb",
    "#7c3aed",
    "#db2777",
  ];
  return palette[(bib as number) % palette.length]!;
}

export function CourseVisualization({ rows }: CourseVisualizationProps) {
  // Only race rows that are currently running. Telemetry rows (id "tel-…")
  // are part of the data stream but not represented on the course.
  const inFlight = rows.filter(
    (r) => r.status === "running" && !r.id.startsWith("tel-"),
  );

  return (
    <svg
      data-testid="course-viz"
      role="img"
      aria-label="Live course position — Giant Slalom"
      viewBox={`0 0 ${VIEWBOX_W} ${VIEWBOX_H}`}
      preserveAspectRatio="xMidYMid meet"
      style={{ width: "100%", height: "100%", display: "block" }}
    >
      <title>Mt. Bachelor giant slalom course</title>

      {/* Slope background */}
      <rect
        x="0"
        y="0"
        width={VIEWBOX_W}
        height={VIEWBOX_H}
        fill="var(--pt-bg-card)"
      />

      {/* Course line — shallow S-curves from start to finish */}
      <path
        d={`M50 ${START_Y} C 30 ${(START_Y + GATES[0].y) / 2} 70 ${(GATES[0].y + GATES[1].y) / 2}
            50 ${GATES[1].y} S 30 ${(GATES[2].y + GATES[3].y) / 2} 50 ${GATES[4].y}`}
        stroke="var(--pt-accent-deep, #c2410c)"
        strokeWidth={1.5}
        fill="none"
        opacity={0.5}
      />

      {/* Gate ticks + labels */}
      {GATES.map((gate) => (
        <g key={gate.id}>
          <line
            x1={35}
            y1={gate.y}
            x2={65}
            y2={gate.y}
            stroke="var(--pt-rule, #d6d3d1)"
            strokeWidth={0.8}
            opacity={0.7}
          />
          <text
            x={70}
            y={gate.y + 3}
            fontSize={8}
            fontFamily="ui-monospace, monospace"
            fill="var(--pt-text-muted, #57534e)"
          >
            {gate.id}
          </text>
        </g>
      ))}

      {/* Racer dots */}
      {inFlight.map((row) => {
        const cy = computeRacerY(row);
        const isLeader = row.delta === "LEADER";
        return (
          <circle
            key={row.id}
            data-testid="racer-dot"
            data-leader={isLeader}
            cx={50}
            cy={cy}
            r={isLeader ? 7 : 5}
            fill={dotColor(row.bib)}
            stroke={isLeader ? "var(--pt-accent, #ea580c)" : "none"}
            strokeWidth={isLeader ? 2 : 0}
            style={{ transition: "cy 1.6s linear" }}
          />
        );
      })}
    </svg>
  );
}
