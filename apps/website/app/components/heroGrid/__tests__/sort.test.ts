import { describe, expect, it } from "vitest";

import { applySort, rankRows, type SortState } from "../sort";
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
      make({
        id: "a",
        bib: 1,
        status: "finished",
        finish: "01:18.00",
        delta: "+1.50",
      }),
      make({
        id: "b",
        bib: 2,
        status: "finished",
        finish: "01:16.50",
        delta: "LEADER",
      }),
      make({
        id: "c",
        bib: 3,
        status: "finished",
        finish: "01:17.20",
        delta: "+0.70",
      }),
    ];
    expect(rankRows(rows).map((r) => r.id)).toEqual(["b", "c", "a"]);
  });

  it("orders running by gate progress desc, then latest gate time asc", () => {
    const rows: RaceRow[] = [
      make({ id: "early", bib: 1, status: "running", gate1: "00:14.50" }),
      make({
        id: "late",
        bib: 2,
        status: "running",
        gate1: "00:14.30",
        gate2: "00:36.00",
        gate3: "00:55.00",
      }),
      make({
        id: "mid",
        bib: 3,
        status: "running",
        gate1: "00:14.40",
        gate2: "00:36.10",
      }),
    ];
    expect(rankRows(rows).map((r) => r.id)).toEqual(["late", "mid", "early"]);
  });

  it("places finished above running, running above DNF, DNF above DNS", () => {
    const rows: RaceRow[] = [
      make({ id: "dns", bib: 1 }),
      make({ id: "dnf", bib: 2, status: "DNF" }),
      make({ id: "running", bib: 3, status: "running", gate1: "00:14.00" }),
      make({
        id: "finished",
        bib: 4,
        status: "finished",
        finish: "01:16.00",
        delta: "LEADER",
      }),
    ];
    expect(rankRows(rows).map((r) => r.id)).toEqual([
      "finished",
      "running",
      "dnf",
      "dns",
    ]);
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
      make({
        id: "high",
        bib: 30,
        status: "running",
        gate1: "00:14.00",
        gate2: "00:36.00",
      }),
      make({
        id: "low",
        bib: 5,
        status: "running",
        gate1: "00:14.00",
        gate2: "00:36.00",
      }),
    ];
    // same gate2 time → bib ascending tie-break
    expect(rankRows(rows).map((r) => r.id)).toEqual(["low", "high"]);
  });

  it("sinks telemetry rows (bib === '—') to the bottom of their tier", () => {
    const rows: RaceRow[] = [
      make({
        id: "tel-1",
        bib: "—",
        status: "running",
        racer: "Sensor: gate 4 wind",
      }),
      make({ id: "race-1", bib: 5, status: "running", gate1: "00:14.00" }),
    ];
    expect(rankRows(rows).map((r) => r.id)).toEqual(["race-1", "tel-1"]);
  });
});

describe("applySort", () => {
  it("returns rankRows order when sort is null", () => {
    const rows: RaceRow[] = [
      make({ id: "a", bib: 30 }),
      make({
        id: "b",
        bib: 1,
        status: "finished",
        finish: "01:16.00",
        delta: "LEADER",
      }),
    ];
    expect(applySort(rows, null).map((r) => r.id)).toEqual(["b", "a"]);
  });

  it("sorts by bib asc with telemetry sunk", () => {
    const rows: RaceRow[] = [
      make({ id: "tel", bib: "—" }),
      make({ id: "b", bib: 5 }),
      make({ id: "a", bib: 1 }),
    ];
    const sort: SortState = { columnId: "bib", direction: "asc" };
    expect(applySort(rows, sort).map((r) => r.id)).toEqual(["a", "b", "tel"]);
  });

  it("sorts delta asc with LEADER first and empty last", () => {
    const rows: RaceRow[] = [
      make({ id: "empty", bib: 1 }),
      make({ id: "plus", bib: 2, status: "finished", delta: "+0.45" }),
      make({ id: "leader", bib: 3, status: "finished", delta: "LEADER" }),
    ];
    const sort: SortState = { columnId: "delta", direction: "asc" };
    expect(applySort(rows, sort).map((r) => r.id)).toEqual([
      "leader",
      "plus",
      "empty",
    ]);
  });

  it("sorts status by explicit rank: finished < running < DNF < DSQ < dns", () => {
    const rows: RaceRow[] = [
      make({ id: "dns", bib: 1, status: "dns" }),
      make({ id: "dsq", bib: 2, status: "DSQ" }),
      make({ id: "dnf", bib: 3, status: "DNF" }),
      make({ id: "run", bib: 4, status: "running" }),
      make({ id: "fin", bib: 5, status: "finished" }),
    ];
    const sort: SortState = { columnId: "status", direction: "asc" };
    expect(applySort(rows, sort).map((r) => r.id)).toEqual([
      "fin",
      "run",
      "dnf",
      "dsq",
      "dns",
    ]);
  });

  it("reverses with desc direction", () => {
    const rows: RaceRow[] = [
      make({ id: "a", bib: 1 }),
      make({ id: "b", bib: 2 }),
      make({ id: "c", bib: 3 }),
    ];
    const sort: SortState = { columnId: "bib", direction: "desc" };
    expect(applySort(rows, sort).map((r) => r.id)).toEqual(["c", "b", "a"]);
  });

  it("sorts gate1 with empty values sinking", () => {
    const rows: RaceRow[] = [
      make({ id: "empty", bib: 1 }),
      make({ id: "fast", bib: 2, gate1: "00:14.00" }),
      make({ id: "slow", bib: 3, gate1: "00:14.50" }),
    ];
    const sort: SortState = { columnId: "gate1", direction: "asc" };
    expect(applySort(rows, sort).map((r) => r.id)).toEqual([
      "fast",
      "slow",
      "empty",
    ]);
  });

  it("sorts racer column with localeCompare", () => {
    const rows: RaceRow[] = [
      make({ id: "z", bib: 1, racer: "Zoé" }),
      make({ id: "a", bib: 2, racer: "Anna" }),
    ];
    const sort: SortState = { columnId: "racer", direction: "asc" };
    expect(applySort(rows, sort).map((r) => r.id)).toEqual(["a", "z"]);
  });

  it("sorts notes lex with empty sinking", () => {
    const rows: RaceRow[] = [
      make({ id: "empty", bib: 1 }),
      make({ id: "z", bib: 2, notes: "Zooming" }),
      make({ id: "a", bib: 3, notes: "Aggressive" }),
    ];
    const sort: SortState = { columnId: "notes", direction: "asc" };
    expect(applySort(rows, sort).map((r) => r.id)).toEqual(["a", "z", "empty"]);
  });

  it("sinks empty values to bottom under desc direction (empties always last)", () => {
    const rows: RaceRow[] = [
      make({ id: "empty", bib: 1 }),
      make({ id: "fast", bib: 2, gate1: "00:14.00" }),
      make({ id: "slow", bib: 3, gate1: "00:14.50" }),
    ];
    const sort: SortState = { columnId: "gate1", direction: "desc" };
    // desc: slowest first among non-empty, empty still at bottom
    expect(applySort(rows, sort).map((r) => r.id)).toEqual([
      "slow",
      "fast",
      "empty",
    ]);
  });
});
