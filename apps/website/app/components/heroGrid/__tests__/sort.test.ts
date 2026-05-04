import { describe, expect, it } from "vitest";

import { rankRows } from "../sort";
import type { RaceRow } from "../types";

const make = (over: Partial<RaceRow>): RaceRow => ({
  id: over.id ?? "x",
  bib: over.bib ?? 0,
  racer: "Test",
  gate1: "",
  gate2: "",
  gate3: "",
  finish: "",
  delta: "",
  status: "dns",
  notes: "",
  ...over,
});

describe("rankRows", () => {
  it("orders finished by finish time asc with LEADER first", () => {
    const rows: RaceRow[] = [
      make({ id: "a", bib: 1, status: "finished", finish: "01:18.00", delta: "+1.50" }),
      make({ id: "b", bib: 2, status: "finished", finish: "01:16.50", delta: "LEADER" }),
      make({ id: "c", bib: 3, status: "finished", finish: "01:17.20", delta: "+0.70" }),
    ];
    expect(rankRows(rows).map((r) => r.id)).toEqual(["b", "c", "a"]);
  });

  it("orders running by gate progress desc, then latest gate time asc", () => {
    const rows: RaceRow[] = [
      make({ id: "early", bib: 1, status: "running", gate1: "00:14.50" }),
      make({ id: "late", bib: 2, status: "running", gate1: "00:14.30", gate2: "00:36.00", gate3: "00:55.00" }),
      make({ id: "mid", bib: 3, status: "running", gate1: "00:14.40", gate2: "00:36.10" }),
    ];
    expect(rankRows(rows).map((r) => r.id)).toEqual(["late", "mid", "early"]);
  });

  it("places finished above running, running above DNF, DNF above DNS", () => {
    const rows: RaceRow[] = [
      make({ id: "dns", bib: 1 }),
      make({ id: "dnf", bib: 2, status: "DNF" }),
      make({ id: "running", bib: 3, status: "running", gate1: "00:14.00" }),
      make({ id: "finished", bib: 4, status: "finished", finish: "01:16.00", delta: "LEADER" }),
    ];
    expect(rankRows(rows).map((r) => r.id)).toEqual(["finished", "running", "dnf", "dns"]);
  });

  it("orders DNS by bib ascending", () => {
    const rows: RaceRow[] = [
      make({ id: "c", bib: 30 }),
      make({ id: "a", bib: 1 }),
      make({ id: "b", bib: 15 }),
    ];
    expect(rankRows(rows).map((r) => r.id)).toEqual(["a", "b", "c"]);
  });

  it("breaks running ties on gate progress by bib ascending", () => {
    const rows: RaceRow[] = [
      make({ id: "high", bib: 30, status: "running", gate1: "00:14.00", gate2: "00:36.00" }),
      make({ id: "low", bib: 5, status: "running", gate1: "00:14.00", gate2: "00:36.00" }),
    ];
    // same gate2 time → bib ascending tie-break
    expect(rankRows(rows).map((r) => r.id)).toEqual(["low", "high"]);
  });

  it("sinks telemetry rows (bib === '—') to the bottom of their tier", () => {
    const rows: RaceRow[] = [
      make({ id: "tel-1", bib: "—", status: "running", racer: "Sensor: gate 4 wind" }),
      make({ id: "race-1", bib: 5, status: "running", gate1: "00:14.00" }),
    ];
    expect(rankRows(rows).map((r) => r.id)).toEqual(["race-1", "tel-1"]);
  });
});
