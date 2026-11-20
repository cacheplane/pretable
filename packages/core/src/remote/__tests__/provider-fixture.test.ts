import { expect, it } from "vitest";
import { createDeferredProvider } from "./fixtures/provider";
import type {
  PretableRemoteCapabilities,
  PretableRemoteQuery,
  PretableRemoteSession,
} from "../types";

const capabilities: PretableRemoteCapabilities = {
  rangeAccess: "ordinal",
  exactCounts: true,
  consistency: "immutable",
  fields: {},
  comparisons: ["binary@1"],
  aggregates: [],
  search: false,
  summaries: { filtered: "unavailable", all: "unavailable" },
  maxGroupDepth: 0,
  maxRangeSize: 10,
};
const query: PretableRemoteQuery<readonly []> = {
  source: "fixture",
  authScope: "scope",
  schemaVersion: "1",
  registryVersion: "1",
  comparison: "binary@1",
  locale: "en",
  filters: [],
  rowGroups: [],
  sort: [],
  groupSort: [],
  aggregates: [],
  projection: [],
};
const session: PretableRemoteSession = {
  sessionId: "session",
  queryKey: "query",
  resultToken: "version",
  rootCount: 0,
};
it("allows independently deferred responses to finish out of order, including after ignored abort", async () => {
  const fixture = createDeferredProvider<object, readonly []>(capabilities);
  const abort = new AbortController();
  const first = fixture.provider.open(query, "first", abort.signal);
  const second = fixture.provider.open(query, "second", abort.signal);
  abort.abort();
  fixture.opens[1]!.resolve({
    ok: true,
    value: { ...session, queryKey: "second" },
  });
  expect(await second).toMatchObject({
    ok: true,
    value: { queryKey: "second" },
  });
  fixture.opens[0]!.resolve({
    ok: true,
    value: { ...session, queryKey: "first" },
  });
  expect(await first).toMatchObject({ ok: true, value: { queryKey: "first" } });
  await fixture.provider.release(session);
  expect(fixture.released).toEqual([session]);
});
it("optionally settles pending range/summary requests on abort and ignores later resolution", async () => {
  const fixture = createDeferredProvider<object, readonly []>(capabilities, {
    honorAbort: true,
  });
  const abort = new AbortController();
  const range = fixture.provider.read(
    { ...session, route: [], start: 0, end: 1 },
    abort.signal,
  );
  const summary = fixture.provider.summary(session, "all", abort.signal);
  abort.abort();
  const cancelled = { ok: false, error: { code: "cancelled" } };
  expect(await range).toEqual(cancelled);
  expect(await summary).toEqual(cancelled);
  fixture.reads[0]!.resolve({ ok: false, error: { code: "expired" } });
  expect(await range).toEqual(cancelled);
  expect(await fixture.provider.open(query, "query", abort.signal)).toEqual(
    cancelled,
  );
});
