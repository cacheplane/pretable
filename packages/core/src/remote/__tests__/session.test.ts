import { describe, expect, it } from "vitest";
import { createRemoteSessionController } from "../session";
import { createDeferredProvider } from "./fixtures/provider";
import {
  capabilities,
  query,
  range,
  session,
  groupedQuery,
  summary,
  type Row,
  type Columns,
} from "./fixtures/responses";
import type { PretableRemoteError, PretableRemoteQuery } from "../types";

const tick = async () => {
  for (let i = 0; i < 8; i++) await Promise.resolve();
};
function setup() {
  const transport = createDeferredProvider<Row, Columns>(capabilities);
  const resets: string[] = [];
  let now = 0;
  const controller = createRemoteSessionController(transport.provider, {
    rootRangeSize: 2,
    now: () => now,
    onReset: (event) => resets.push(event.reason),
  });
  const open = async (index = 0, patch = {}) => {
    transport.opens[index]!.resolve({
      ok: true,
      value: {
        ...session,
        ...patch,
        queryKey: transport.opens[index]!.request.queryKey,
      },
    });
    await tick();
  };
  const resolveRead = (index: number, patch = {}) => {
    const request = transport.reads[index]!.request;
    transport.reads[index]!.resolve({
      ok: true,
      value: { ...range(request.start, request.end), ...request, ...patch },
    });
  };
  const ready = async () => {
    const promise = controller.setQuery(query);
    await open();
    resolveRead(0);
    await promise;
  };
  return {
    ...transport,
    controller,
    resets,
    open,
    resolveRead,
    ready,
    setNow: (value: number) => {
      now = value;
    },
  };
}

describe("remote session ownership", () => {
  it("publishes only the newest A→B→A generation even with identical tokens", async () => {
    const f = setup();
    const a = f.controller.setQuery(query);
    const b = f.controller.setQuery({ ...query, search: "B" });
    const a2 = f.controller.setQuery(query);
    await f.open(2, { sessionId: "A2" });
    f.resolveRead(0);
    await a2;
    await f.open(0, { sessionId: "A1" });
    await a;
    f.opens[1]!.resolve({
      ok: false,
      error: { code: "unauthorized", scope: "session" },
    });
    await b;
    expect(f.controller.getSnapshot().view?.session.sessionId).toBe("A2");
    expect(f.reads).toHaveLength(1);
    expect(f.released.map((s) => s.sessionId)).toContain("A1");
    expect(f.resets).toEqual(["query", "query", "query"]);
  });
  it("keeps at most one coherent stale view until a replacement root commits atomically", async () => {
    const f = setup();
    await f.ready();
    const old = f.controller.getSnapshot().view;
    const pending = f.controller.setQuery({ ...query, search: "B" });
    expect(f.controller.getSnapshot().state).toBe("stale");
    expect(f.resets).toEqual(["query", "query"]);
    await f.open(1, { sessionId: "B" });
    expect(f.controller.getSnapshot().view).toBe(old);
    expect(f.controller.retention().views).toBe(1);
    f.resolveRead(1);
    await pending;
    expect(f.controller.getSnapshot().state).toBe("ready");
    expect(f.controller.getSnapshot().view?.session.queryKey).not.toBe(
      old?.session.queryKey,
    );
    expect(f.controller.getSnapshot().view?.ranges).toHaveLength(1);
    expect(f.released).toContainEqual(old?.session);
  });
  it("owns retries per range and permits independent ranges out of order", async () => {
    const f = setup();
    await f.ready();
    const old = f.controller.read([], 2, 3);
    const retry = f.controller.read([], 2, 3);
    const independent = f.controller.read([], 3, 4);
    f.resolveRead(3);
    await independent;
    f.resolveRead(2);
    await retry;
    f.reads[1]!.resolve({
      ok: false,
      error: { code: "unauthorized", scope: "range" },
    });
    await old;
    expect(f.controller.getSnapshot().state).toBe("ready");
    expect(
      f.controller
        .getSnapshot()
        .view?.ranges.map((r) => r.start)
        .sort(),
    ).toEqual([0, 2, 3]);
    expect(f.reads[1]!.signal.aborted).toBe(true);
  });
  it("rejects late successes and errors from replaced query sessions sharing a token", async () => {
    const f = setup();
    await f.ready();
    const lateSuccess = f.controller.read([], 2, 3);
    const lateError = f.controller.read([], 3, 4);
    const next = f.controller.setQuery({ ...query, search: "B" });
    await f.open(1);
    f.resolveRead(3);
    await next;
    f.resolveRead(1, {
      entries: [{ kind: "leaf", id: 2, row: { value: 99 } }],
    });
    await lateSuccess;
    f.reads[2]!.resolve({ ok: false, error: { code: "consistency" } });
    await lateError;
    expect(f.controller.getSnapshot().state).toBe("ready");
    expect(f.controller.getSnapshot().view?.ranges).toHaveLength(1);
  });
  it.each(["expired", "consistency", "unauthorized"] as const)(
    "handles current %s errors with the required data scope",
    async (code) => {
      const f = setup();
      await f.ready();
      const pending = f.controller.read([], 2, 4);
      const error: PretableRemoteError =
        code === "unauthorized" ? { code, scope: "session" } : { code };
      f.reads[1]!.resolve({ ok: false, error });
      await pending;
      expect(f.controller.getSnapshot().view !== undefined).toBe(
        code === "expired",
      );
      expect(f.controller.getSnapshot().state).toBe(
        code === "expired" ? "stale" : "error",
      );
      await f.controller.read([], 2, 4);
      expect(f.reads).toHaveLength(2);
      expect(f.opens).toHaveLength(1);
      const refresh = f.controller.refresh();
      expect(f.resets.at(-1)).toBe("refresh");
      await f.open(1);
      f.resolveRead(2);
      await refresh;
      expect(f.controller.getSnapshot().state).toBe("ready");
    },
  );
  it("keeps data on range failures but purges denied range data and resets selection", async () => {
    const f = setup();
    await f.ready();
    const transient = f.controller.read([], 2, 4);
    f.reads[1]!.resolve({ ok: false, error: { code: "transient" } });
    await transient;
    expect(f.controller.getSnapshot().view?.ranges).toHaveLength(1);
    const denied = f.controller.read([], 0, 1);
    f.reads[2]!.resolve({
      ok: false,
      error: { code: "unauthorized", scope: "range" },
    });
    await denied;
    expect(f.controller.getSnapshot().view?.ranges).toHaveLength(0);
    expect(f.resets.at(-1)).toBe("range-unauthorized");
  });
  it("purges stale protected data on scope changes and current replacement-open revocation", async () => {
    const f = setup();
    await f.ready();
    const next = f.controller.refresh();
    expect(f.controller.getSnapshot().view).toBeDefined();
    f.opens[1]!.resolve({
      ok: false,
      error: { code: "unauthorized", scope: "session" },
    });
    await next;
    expect(f.controller.getSnapshot().view).toBeUndefined();
    const again = f.controller.setQuery({ ...query, authScope: "new" });
    expect(f.controller.getSnapshot().view).toBeUndefined();
    await f.open(2);
    f.resolveRead(1);
    await again;
    const change = f.controller.setQuery(query);
    expect(f.controller.getSnapshot().view).toBeUndefined();
    f.opens[3]!.resolve({ ok: false, error: { code: "transient" } });
    await change;
  });
  it("does not publish malformed root fragments and read access never dispatches", async () => {
    const f = setup();
    await f.ready();
    const old = f.controller.getSnapshot().view;
    const next = f.controller.refresh();
    await f.open(1);
    f.resolveRead(1, { entries: [] });
    await next;
    expect(f.controller.getSnapshot().view).toBe(old);
    expect(f.controller.getSnapshot().error?.code).toBe("invalid-response");
    for (let i = 0; i < 10; i++) f.controller.getSnapshot();
    expect(f.reads).toHaveLength(2);
    expect(f.opens).toHaveLength(2);
  });
  it("freezes expired sessions by deadline and disposes without accepting late answers", async () => {
    const f = setup();
    const start = f.controller.setQuery(query);
    await f.open(0, { expiresAt: 10 });
    f.resolveRead(0);
    await start;
    f.setNow(10);
    await f.controller.read([], 2, 4);
    expect(f.controller.getSnapshot().state).toBe("stale");
    expect(f.reads).toHaveLength(1);
    const next = f.controller.refresh();
    f.controller.dispose();
    await f.open(1, { sessionId: "late" });
    await next;
    expect(f.controller.getSnapshot()).toEqual({
      state: "disposed",
      generation: 3,
    });
    expect(f.controller.retention()).toEqual({
      views: 0,
      nodes: 0,
      counts: 0,
      summaries: 0,
    });
    expect(f.released.map((s) => s.sessionId)).toContain("late");
  });
  it("validates summaries with the same ownership and consistency rules", async () => {
    const f = setup();
    const q: PretableRemoteQuery<Columns> = {
      ...query,
      aggregates: groupedQuery.aggregates,
    };
    const start = f.controller.setQuery(q);
    await f.open();
    f.resolveRead(0);
    await start;
    const first = f.controller.summary("filtered"),
      second = f.controller.summary("filtered");
    f.summaries[1]!.resolve({
      ok: true,
      value: { ...summary(), ...f.summaries[1]!.request.session },
    });
    await second;
    f.summaries[0]!.resolve({ ok: false, error: { code: "expired" } });
    await first;
    expect(f.controller.getSnapshot().state).toBe("ready");
    const contradiction = f.controller.summary("filtered");
    f.summaries[2]!.resolve({
      ok: true,
      value: { ...summary(99), ...f.summaries[2]!.request.session },
    });
    await contradiction;
    expect(f.controller.getSnapshot().view).toBeUndefined();
  });
  it("invokes transport through the external permit seam and releases best effort", async () => {
    const f = setup();
    const kinds: string[] = [];
    f.provider.release = async () => {
      throw new Error("release failed");
    };
    const c = createRemoteSessionController(f.provider, {
      rootRangeSize: 2,
      invoke: async (operation, run) => {
        kinds.push(operation.kind);
        return run();
      },
    });
    const promise = c.setQuery(query);
    await f.open();
    f.resolveRead(0);
    await promise;
    c.dispose();
    await tick();
    expect(kinds).toEqual(["open", "read"]);
    expect(c.getSnapshot().state).toBe("disposed");
  });
  it("purges protected stale data on source change even when preparation fails", async () => {
    const f = setup();
    await f.ready();
    await f.controller.setQuery({
      ...query,
      source: "other",
      comparison: "unsupported",
    });
    expect(f.controller.getSnapshot().view).toBeUndefined();
    expect(f.controller.getSnapshot().error?.code).toBe("unsupported-query");
  });
  it("evicts published payload and overlap evidence together without retaining history", async () => {
    const f = setup();
    await f.ready();
    const retainedByConsumer = f.controller.getSnapshot();
    f.controller.evictRange([], 0, 2);
    expect(f.controller.getSnapshot().view?.ranges).toHaveLength(0);
    expect(f.controller.retention().nodes).toBe(0);
    expect(retainedByConsumer.view?.ranges[0]?.entries).toHaveLength(2);
    const read = f.controller.read([], 0, 2);
    f.resolveRead(1);
    await read;
    expect(f.controller.getSnapshot().view?.ranges).toHaveLength(1);
  });
  it("atomically publishes an empty root after confirming its count", async () => {
    const f = setup();
    const pending = f.controller.setQuery(query);
    await f.open(0, { rootCount: 0 });
    expect(f.controller.getSnapshot().view).toBeUndefined();
    f.resolveRead(0, { siblingCount: 0, entries: [] });
    await pending;
    expect(f.controller.getSnapshot().state).toBe("ready");
    expect(f.controller.getSnapshot().view?.session.rootCount).toBe(0);
  });
  it("does not dispatch a queued obsolete operation after its permit arrives", async () => {
    const f = setup();
    const queued: (() => void)[] = [];
    const c = createRemoteSessionController(f.provider, {
      invoke: (_operation, run) =>
        new Promise((resolve) =>
          queued.push(() => {
            void run().then(resolve);
          }),
        ),
    });
    const first = c.setQuery(query);
    const second = c.setQuery({ ...query, search: "B" });
    queued[0]!();
    await first;
    expect(f.opens).toHaveLength(0);
    c.dispose();
    queued[1]!();
    await second;
    expect(f.opens).toHaveLength(0);
  });
  it("rejects an unknown child route before dispatch and cancels overlapping reads on range denial", async () => {
    const f = setup();
    await f.ready();
    await f.controller.read([{ columnId: "value", key: 1 }], 0, 1);
    expect(f.reads).toHaveLength(1);
    const overlap = f.controller.read([], 0, 2);
    const unrelated = f.controller.read([], 2, 4);
    const denied = f.controller.read([], 0, 1);
    f.reads[3]!.resolve({
      ok: false,
      error: { code: "unauthorized", scope: "range" },
    });
    await denied;
    f.resolveRead(1);
    await overlap;
    f.resolveRead(2);
    await unrelated;
    expect(f.controller.getSnapshot().view?.ranges.map((r) => r.start)).toEqual(
      [2],
    );
  });
  it("publishes no notifications for obsolete results and supports unsubscribe", async () => {
    const f = setup();
    let calls = 0;
    const unsubscribe = f.controller.subscribe(() => {
      calls++;
    });
    await f.ready();
    expect(calls).toBe(2);
    unsubscribe();
    f.controller.dispose();
    expect(calls).toBe(2);
  });
  it("never invokes rejected query accessors while clearing protected stale state", async () => {
    for (const field of ["source", "authScope"]) {
      const f = setup();
      await f.ready();
      let called = false;
      const invalid = { ...query };
      Object.defineProperty(invalid, field, {
        enumerable: true,
        get() {
          called = true;
          throw new Error("private getter");
        },
      });
      await f.controller.setQuery(invalid);
      expect(called).toBe(false);
      expect(f.controller.getSnapshot().error?.code).toBe("invalid-query");
      expect(f.controller.getSnapshot().view).toBeUndefined();
    }
  });
  it("snapshot observation performs no I/O; explicit expiry check freezes the view", async () => {
    const f = setup();
    const pending = f.controller.setQuery(query);
    await f.open(0, { expiresAt: 10 });
    f.resolveRead(0);
    await pending;
    f.setNow(11);
    f.controller.getSnapshot();
    expect(f.released).toHaveLength(0);
    f.controller.checkExpiry();
    expect(f.controller.getSnapshot().state).toBe("stale");
    expect(f.opens).toHaveLength(1);
  });
  it("range denial cancels summaries whose protected results were cleared", async () => {
    const f = setup();
    const pending = f.controller.setQuery({
      ...query,
      aggregates: groupedQuery.aggregates,
    });
    await f.open();
    f.resolveRead(0);
    await pending;
    const total = f.controller.summary("filtered");
    const denied = f.controller.read([], 0, 1);
    f.reads[1]!.resolve({
      ok: false,
      error: { code: "unauthorized", scope: "range" },
    });
    await denied;
    f.summaries[0]!.resolve({
      ok: true,
      value: { ...summary(), ...f.summaries[0]!.request.session },
    });
    await total;
    expect(f.controller.getSnapshot().view?.summaries).toEqual([]);
    expect(f.summaries[0]!.signal.aborted).toBe(true);
  });
  it("eviction removes failed-range diagnostics as well as payload", async () => {
    const f = setup();
    await f.ready();
    const pending = f.controller.read([], 2, 4);
    f.reads[1]!.resolve({ ok: false, error: { code: "transient" } });
    await pending;
    expect(Object.keys(f.controller.getSnapshot().errors ?? {})).toHaveLength(
      1,
    );
    f.controller.evictRange([], 2, 4);
    expect(Object.keys(f.controller.getSnapshot().errors ?? {})).toHaveLength(
      0,
    );
  });
  it("checks expiry again when a queued permit finally starts", async () => {
    const f = setup();
    const queued: (() => void)[] = [];
    let now = 0;
    const c = createRemoteSessionController(f.provider, {
      now: () => now,
      invoke: (_operation, run) =>
        new Promise((resolve) =>
          queued.push(() => {
            void run().then(resolve);
          }),
        ),
    });
    const pending = c.setQuery(query);
    queued[0]!();
    await f.open(0, { expiresAt: 10 });
    now = 11;
    queued[1]!();
    await pending;
    expect(f.reads).toHaveLength(0);
    expect(c.getSnapshot().error?.code).toBe("expired");
  });
  it("can evict summary payload and evidence together for cache admission", async () => {
    const f = setup();
    const pending = f.controller.setQuery({
      ...query,
      aggregates: groupedQuery.aggregates,
    });
    await f.open();
    f.resolveRead(0);
    await pending;
    const total = f.controller.summary("filtered");
    f.summaries[0]!.resolve({
      ok: true,
      value: { ...summary(), ...f.summaries[0]!.request.session },
    });
    await total;
    expect(f.controller.retention().summaries).toBe(1);
    f.controller.evictSummary("filtered");
    expect(f.controller.retention().summaries).toBe(0);
    expect(f.controller.getSnapshot().view?.summaries).toEqual([]);
  });
  it.each(["expired", "deadline", "superseded"] as const)(
    "honors authoritative current-session revocation after %s",
    async (mode) => {
      const f = setup();
      const start = f.controller.setQuery(query);
      await f.open(0, { expiresAt: 10 });
      f.resolveRead(0);
      await start;
      const pending = f.controller.read([], 2, 4);
      let retry: Promise<void> | undefined;
      if (mode === "expired") {
        f.setNow(10);
        f.controller.checkExpiry();
      }
      if (mode === "deadline") f.setNow(10);
      if (mode === "superseded") retry = f.controller.read([], 2, 4);
      f.reads[1]!.resolve({
        ok: false,
        error: { code: "unauthorized", scope: "session" },
      });
      await pending;
      expect(f.controller.getSnapshot().view).toBeUndefined();
      expect(f.controller.getSnapshot().error).toEqual({
        code: "unauthorized",
        scope: "session",
      });
      expect(f.resets.at(-1)).toBe("session-unauthorized");
      if (retry) {
        f.resolveRead(2);
        await retry;
        expect(f.controller.getSnapshot().view).toBeUndefined();
      }
    },
  );

  it("removes only a revoked retiring stale view while preserving the new candidate", async () => {
    const f = setup();
    await f.ready();
    const old = f.controller.read([], 2, 4);
    const replacement = f.controller.setQuery({ ...query, search: "B" });
    await f.open(1, { sessionId: "replacement" });
    f.reads[1]!.resolve({
      ok: false,
      error: { code: "unauthorized", scope: "session" },
    });
    await old;
    expect(f.controller.getSnapshot().view).toBeUndefined();
    expect(f.controller.getSnapshot().state).toBe("loading");
    expect(f.controller.getSnapshot().error).toBeUndefined();
    f.resolveRead(2);
    await replacement;
    expect(f.controller.getSnapshot().state).toBe("ready");
    expect(f.controller.getSnapshot().view?.session.sessionId).toBe(
      "replacement",
    );
  });
  it("ignores old-session revocation after the replacement root committed", async () => {
    const f = setup();
    await f.ready();
    const old = f.controller.read([], 2, 4);
    const replacement = f.controller.setQuery({ ...query, search: "B" });
    await f.open(1, { sessionId: "replacement" });
    f.resolveRead(2);
    await replacement;
    f.reads[1]!.resolve({
      ok: false,
      error: { code: "unauthorized", scope: "session" },
    });
    await old;
    expect(f.controller.getSnapshot().state).toBe("ready");
    expect(f.controller.getSnapshot().view?.session.sessionId).toBe(
      "replacement",
    );
  });
  it("does not resume an older start after reset synchronously selects a newer query", async () => {
    const f = setup();
    let next: Promise<void> | undefined;
    const c = createRemoteSessionController(f.provider, {
      rootRangeSize: 2,
      onReset: (event) => {
        if (event.generation === 1)
          next = c.setQuery({ ...query, search: "B" });
      },
    });
    const first = c.setQuery({ ...query, search: "A" });
    expect(f.opens.map((p) => p.request.query.search)).toEqual(["B"]);
    await f.open();
    f.resolveRead(0);
    await next;
    await first;
    expect(c.getSnapshot().view?.session.queryKey).toBe(
      f.opens[0]!.request.queryKey,
    );
  });
  it("cannot resurrect a controller disposed by its reset callback", async () => {
    const f = setup();
    const c = createRemoteSessionController(f.provider, {
      onReset: (event) => {
        if (event.reason === "query") c.dispose();
      },
    });
    const first = c.setQuery(query);
    expect(c.getSnapshot().state).toBe("disposed");
    expect(f.opens).toHaveLength(0);
    await first;
  });
  it.each(["abort", "release"] as const)(
    "keeps a newer query started synchronously by %s cleanup",
    async (boundary) => {
      const f = setup();
      await f.ready();
      let next: Promise<void> | undefined;
      let pending: Promise<void> | undefined;
      const reenter = () => {
        next = f.controller.setQuery({ ...query, search: "B" });
      };
      if (boundary === "abort") {
        pending = f.controller.read([], 2, 4);
        f.reads[1]!.signal.addEventListener("abort", reenter, { once: true });
      } else {
        let called = false;
        f.provider.release = async () => {
          if (!called) {
            called = true;
            reenter();
          }
        };
      }
      const older = f.controller.setQuery({ ...query, search: "A" });
      expect(f.opens.slice(1).map((p) => p.request.query.search)).toEqual([
        "B",
      ]);
      await f.open(1);
      f.resolveRead(boundary === "abort" ? 2 : 1);
      await next;
      await older;
      if (pending) {
        f.resolveRead(1);
        await pending;
      }
      expect(f.controller.getSnapshot().view?.session.queryKey).toBe(
        f.opens[1]!.request.queryKey,
      );
    },
  );
  it("lets an abort-listener retry supersede the attempt that triggered its abort", async () => {
    const f = setup();
    await f.ready();
    const first = f.controller.read([], 2, 4);
    let latest: Promise<void> | undefined;
    f.reads[1]!.signal.addEventListener(
      "abort",
      () => {
        latest = f.controller.read([], 2, 4);
      },
      { once: true },
    );
    const middle = f.controller.read([], 2, 4);
    expect(f.reads).toHaveLength(3);
    f.resolveRead(2);
    await latest;
    await middle;
    f.resolveRead(1);
    await first;
    expect(f.controller.getSnapshot().view?.ranges.map((r) => r.start)).toEqual(
      [0, 2],
    );
  });
  it("does not overwrite a refresh started by an error reset callback", async () => {
    const f = setup();
    let refresh: Promise<void> | undefined;
    const c = createRemoteSessionController(f.provider, {
      rootRangeSize: 2,
      onReset: (event) => {
        if (event.reason === "session-unauthorized") refresh = c.refresh();
      },
    });
    const start = c.setQuery(query);
    await f.open();
    f.resolveRead(0);
    await start;
    const denied = c.read([], 2, 4);
    f.reads[1]!.resolve({
      ok: false,
      error: { code: "unauthorized", scope: "session" },
    });
    await denied;
    expect(c.getSnapshot().state).toBe("loading");
    await f.open(1);
    f.resolveRead(2);
    await refresh;
    expect(c.getSnapshot().state).toBe("ready");
  });
  it("does not continue range-denial handling after a subscriber disposes", async () => {
    const f = setup();
    await f.ready();
    f.controller.subscribe(() => {
      if (f.controller.getSnapshot().view?.ranges.length === 0)
        f.controller.dispose();
    });
    const denied = f.controller.read([], 0, 1);
    f.reads[1]!.resolve({
      ok: false,
      error: { code: "unauthorized", scope: "range" },
    });
    await denied;
    expect(f.controller.getSnapshot().state).toBe("disposed");
  });
  it("does not dispatch after a loading subscriber replaces or disposes the controller", async () => {
    for (const action of ["replace", "dispose"]) {
      const f = setup();
      let entered = false;
      let next: Promise<void> | undefined;
      f.controller.subscribe(() => {
        if (entered) return;
        entered = true;
        if (action === "dispose") f.controller.dispose();
        else next = f.controller.setQuery({ ...query, search: "B" });
      });
      const first = f.controller.setQuery(query);
      if (action === "dispose") {
        expect(f.opens).toHaveLength(0);
        expect(f.controller.getSnapshot().state).toBe("disposed");
      } else {
        expect(f.opens.map((p) => p.request.query.search)).toEqual(["B"]);
        await f.open();
        f.resolveRead(0);
        await next;
      }
      await first;
    }
  });
  it.each(["expired", "consistency", "unauthorized"] as const)(
    "preserves refresh started by release cleanup for %s",
    async (code) => {
      const f = setup();
      await f.ready();
      let refresh: Promise<void> | undefined;
      let entered = false;
      f.provider.release = async () => {
        if (!entered) {
          entered = true;
          refresh = f.controller.refresh();
        }
      };
      const pending = f.controller.read([], 2, 4);
      f.reads[1]!.resolve({
        ok: false,
        error: code === "unauthorized" ? { code, scope: "session" } : { code },
      });
      await pending;
      expect(f.controller.getSnapshot().state).toBe(
        code === "expired" ? "stale" : "loading",
      );
      expect(f.controller.getSnapshot().error).toBeUndefined();
      await f.open(1);
      f.resolveRead(2);
      await refresh;
      expect(f.controller.getSnapshot().state).toBe("ready");
    },
  );
  it("does not overwrite a query started by the retiring-view revocation reset", async () => {
    const f = setup();
    let latest: Promise<void> | undefined;
    const c = createRemoteSessionController(f.provider, {
      rootRangeSize: 2,
      onReset: (event) => {
        if (event.reason === "session-unauthorized")
          latest = c.setQuery({ ...query, search: "C" });
      },
    });
    const start = c.setQuery(query);
    await f.open();
    f.resolveRead(0);
    await start;
    const old = c.read([], 2, 4);
    const replacement = c.setQuery({ ...query, search: "B" });
    await f.open(1);
    f.reads[1]!.resolve({
      ok: false,
      error: { code: "unauthorized", scope: "session" },
    });
    await old;
    expect(f.opens[2]!.request.query.search).toBe("C");
    expect(c.getSnapshot().state).toBe("loading");
    await f.open(2);
    f.resolveRead(3);
    await latest;
    f.resolveRead(2);
    await replacement;
    expect(c.getSnapshot().view?.session.queryKey).toBe(
      f.opens[2]!.request.queryKey,
    );
  });
  it("does not run an older range after the injected clock synchronously retries it", async () => {
    const f = setup();
    let trigger = false;
    let retry: Promise<void> | undefined;
    const c = createRemoteSessionController(f.provider, {
      rootRangeSize: 2,
      now: () => {
        if (trigger) {
          trigger = false;
          retry = c.read([], 2, 4);
        }
        return 0;
      },
    });
    const start = c.setQuery(query);
    await f.open(0, { expiresAt: 10 });
    f.resolveRead(0);
    await start;
    trigger = true;
    const older = c.read([], 2, 4);
    expect(f.reads).toHaveLength(2);
    f.resolveRead(1);
    await retry;
    await older;
    expect(c.getSnapshot().view?.ranges.map((r) => r.start)).toEqual([0, 2]);
  });
});
