import { describe, expect, test } from "vitest";

import { createColumnHelper } from "../index";
import { createInstrumentedLocalRowModel } from "../diagnostics";
import type { CooperativeTransitionScheduler } from "../cooperative-transition";

interface Row {
  readonly id: number;
  readonly team: string;
  readonly value: number;
}

interface ScheduledEntry {
  readonly task: () => void;
  cancelled: boolean;
}

class ManualScheduler implements CooperativeTransitionScheduler {
  readonly entries: ScheduledEntry[] = [];

  schedule(task: () => void): () => void {
    const entry = { task, cancelled: false };
    this.entries.push(entry);
    return () => {
      entry.cancelled = true;
    };
  }

  flushOne(): boolean {
    const entry = this.entries.shift();
    if (entry === undefined) return false;
    if (!entry.cancelled) entry.task();
    return true;
  }

  flushAll(): void {
    while (this.flushOne()) {
      // Drain callbacks scheduled by earlier callbacks too.
    }
  }
}

const helper = createColumnHelper<Row>();
const columns = [
  helper.accessor("team", { type: "text" }),
  helper.accessor("value", { type: "number", aggregate: "avg" }),
] as const;

function makeRows(count: number): Row[] {
  return Array.from({ length: count }, (_, id) => ({
    id,
    team: `team-${id % 4}`,
    value: id,
  }));
}

function createFixture() {
  let now = 0;
  const scheduler = new ManualScheduler();
  const instrumented = createInstrumentedLocalRowModel({
    rows: makeRows(2_000),
    columns,
    getRowId: (row) => row.id,
    query: { filters: [], sort: [], rowGroups: [] },
    transitionScheduler: scheduler,
    transitionClock: () => now,
  });
  return {
    instrumented,
    scheduler,
    setNow(value: number) {
      now = value;
    },
  };
}

describe("cooperative transition runtime diagnostics", () => {
  test("records enqueue-to-entry wait separately from slice duration", async () => {
    const fixture = createFixture();
    const transition = fixture.instrumented.model.setQuery({
      filters: [],
      sort: [],
      rowGroups: [{ columnId: "team", direction: "asc" }],
    });

    fixture.setNow(5);
    expect(fixture.scheduler.flushOne()).toBe(true);
    const firstRead = fixture.instrumented.diagnostics.read();
    expect(firstRead.work.schedulerWaitDurations).toEqual([5]);
    expect(firstRead.work.schedulerSliceDurations.length).toBeGreaterThan(0);
    expect(
      firstRead.work.schedulerSliceDurations.every(
        (duration) => duration === 0,
      ),
    ).toBe(true);

    fixture.setNow(8);
    expect(fixture.scheduler.flushOne()).toBe(true);
    expect(firstRead.work.schedulerWaitDurations).toEqual([5]);
    expect(
      fixture.instrumented.diagnostics.read().work.schedulerWaitDurations,
    ).toEqual([5, 3]);

    transition.cancel();
    await expect(transition.finished).rejects.toMatchObject({
      name: "PretableTransitionCancelledError",
    });
    fixture.scheduler.flushAll();
    fixture.instrumented.model.dispose();
  });

  test("does not record a wait for a callback cancelled before entry", async () => {
    const fixture = createFixture();
    const transition = fixture.instrumented.model.setQuery({
      filters: [],
      sort: [],
      rowGroups: [{ columnId: "team", direction: "asc" }],
    });

    fixture.setNow(9);
    transition.cancel();
    fixture.scheduler.flushAll();

    await expect(transition.finished).rejects.toMatchObject({
      name: "PretableTransitionCancelledError",
    });
    expect(
      fixture.instrumented.diagnostics.read().work.schedulerWaitDurations,
    ).toEqual([]);
    fixture.instrumented.model.dispose();
  });

  test("resetWork clears scheduler wait samples", async () => {
    const fixture = createFixture();
    const transition = fixture.instrumented.model.setQuery({
      filters: [],
      sort: [],
      rowGroups: [{ columnId: "team", direction: "asc" }],
    });

    fixture.setNow(4);
    fixture.scheduler.flushOne();
    expect(
      fixture.instrumented.diagnostics.read().work.schedulerWaitDurations,
    ).toEqual([4]);

    fixture.instrumented.diagnostics.resetWork();
    expect(
      fixture.instrumented.diagnostics.read().work.schedulerWaitDurations,
    ).toEqual([]);

    transition.cancel();
    await expect(transition.finished).rejects.toMatchObject({
      name: "PretableTransitionCancelledError",
    });
    fixture.scheduler.flushAll();
    fixture.instrumented.model.dispose();
  });
});
