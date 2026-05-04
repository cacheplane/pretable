import type { PretableColumn } from "@pretable/react";

import type { RaceRow } from "./types";

export const raceColumns: PretableColumn<RaceRow>[] = [
  { id: "bib", header: "Bib", widthPx: 50, pinned: "left" },
  { id: "racer", header: "Racer", widthPx: 180 },
  { id: "gate1", header: "G1", widthPx: 70 },
  { id: "gate2", header: "G2", widthPx: 70 },
  { id: "gate3", header: "G3", widthPx: 70 },
  { id: "finish", header: "Finish", widthPx: 90 },
  { id: "delta", header: "Δ", widthPx: 90 },
  { id: "status", header: "Status", widthPx: 100 },
  { id: "notes", header: "Notes", widthPx: 280, wrap: false },
];
