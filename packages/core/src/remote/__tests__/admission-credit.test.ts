import { expect, it } from "vitest";
import { ModelRetention } from "../model-retention";
import { range, type Row } from "./fixtures/responses";
import { wireBytes } from "../wire-cost";
function complete<T>(steps: Generator<void, T>): T {
  for (;;) {
    const step = steps.next();
    if (step.done) return step.value;
  }
}
it("reserves incoming metadata before candidate allocation and releases the credit", () => {
  const retention = new ModelRetention<Row>({});
  retention.begin(1);
  const value = range();
  const before = retention.cache.snapshot().metadataBytes;
  const credit = complete(
    retention.reserveIncomingSteps(1, value, wireBytes(value)),
  )!;
  expect(credit).toBeDefined();
  expect(retention.cache.snapshot().metadataBytes).toBeGreaterThan(
    before + 264 * value.entries.length,
  );
  expect(retention.groups.size).toBe(0);
  expect(retention.ranges()).toHaveLength(0);
  expect(() =>
    complete(retention.reserveIncomingSteps(1, value, wireBytes(value))),
  ).toThrow("exclusive");
  credit.release();
  credit.release();
  expect(retention.cache.snapshot().metadataBytes).toBe(before);
});
it("refuses an incoming metadata credit without allocating or evicting candidate state", () => {
  const retention = new ModelRetention<Row>({ limits: { metadataBytes: 500 } });
  retention.begin(1);
  const value = range();
  const before = retention.cache.snapshot();
  expect(
    complete(retention.reserveIncomingSteps(1, value, wireBytes(value))),
  ).toBeUndefined();
  expect(retention.cache.snapshot()).toEqual(before);
  expect(retention.capacity).toBe("metadata-capacity");
  expect(retention.groups.size).toBe(0);
});
it("exchanges credit and accepted records atomically and revokes candidates on release", () => {
  const retention = new ModelRetention<Row>({});
  retention.begin(1);
  const value = range();
  const credit = complete(
    retention.reserveIncomingSteps(1, value, wireBytes(value)),
  )!;
  const plan = retention.prepare({
    root: true,
    additions: [retention.responseRecord(1, value, true)],
    drops: [{ scope: -1, key: credit.key }],
  })!;
  expect(retention.cache.snapshot().payloadEntries).toBe(0);
  expect(retention.preparationOwnership).toEqual({
    builders: 0,
    candidates: 1,
    credits: 1,
  });
  expect(plan.commit()).toBe(true);
  const accepted = retention.cache.snapshot();
  credit.release();
  expect(retention.cache.snapshot()).toEqual(accepted);
  const replacement = complete(
    retention.reserveIncomingSteps(1, value, wireBytes(value)),
  )!;
  const abandoned = retention.prepare({
    additions: [retention.responseRecord(1, value, true)],
    drops: [{ scope: -1, key: replacement.key }],
  })!;
  replacement.release();
  expect(abandoned.commit()).toBe(false);
  expect(retention.cache.snapshot().payloadEntries).toBe(2);
});

it("releases the exclusive incoming owner during source closure and suspended candidate cancellation", () => {
  const retention = new ModelRetention<Row>({});
  retention.begin(1);
  const value = range();
  const credit = complete(
    retention.reserveIncomingSteps(1, value, wireBytes(value)),
  )!;
  const builder = retention.prepareSteps({
    root: true,
    additions: [retention.responseRecord(1, value, true)],
    drops: [{ scope: -1, key: credit.key }],
  });
  expect(builder.next().done).toBe(false);
  expect(retention.preparationOwnership).toEqual({
    builders: 1,
    candidates: 0,
    credits: 1,
  });
  retention.close(1);
  expect(builder.next()).toEqual({ done: true, value: undefined });
  expect(retention.preparationOwnership).toEqual({
    builders: 0,
    candidates: 0,
    credits: 0,
  });
  expect(retention.cache.snapshot()).toMatchObject({
    metadataBytes: 0,
    payloadEntries: 0,
  });
  retention.begin(2);
  const next = complete(
    retention.reserveIncomingSteps(2, value, wireBytes(value)),
  )!;
  const bytes = retention.cache.snapshot().metadataBytes;
  credit.release();
  expect(retention.cache.snapshot().metadataBytes).toBe(bytes);
  next.release();
});
