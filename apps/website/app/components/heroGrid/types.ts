export interface RaceRow extends Record<string, unknown> {
  /** Stable row id; matches `bib` for race rows, `tel-{n}` for telemetry rows at HEAVY tier. */
  id: string;
  /** Bib number — 1..30 for race rows, "—" for telemetry rows. */
  bib: number | "—";
  /** Racer display: "Marco Odermatt 🇨🇭" — flag is a Unicode emoji. */
  racer: string;
  /** Intermediate split times in mm:ss.cc format. Empty until racer crosses the gate. */
  gate1: string;
  gate2: string;
  gate3: string;
  /** Final run time. Empty until racer finishes. */
  finish: string;
  /** Signed delta to current leader: "+0.32" / "-0.04" / "LEADER". Empty until racer finishes. */
  delta: string;
  /** Lifecycle: "dns" → "running" → "finished" / "DNF" / "DSQ". */
  status: "dns" | "running" | "finished" | "DNF" | "DSQ";
  /** Race commentary; multiline; streams in token-by-token at PROD+ tiers. */
  notes: string;
}
