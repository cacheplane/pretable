import assert from "node:assert/strict";
import test from "node:test";

import { collectSelfTime } from "../analyze-cdp-core.mjs";

/**
 * A CDP trace's `timeDeltas` form ONE continuous stream that begins at the
 * `Profile` event's `startTime`. Each delta is the gap from the previous
 * SAMPLE, not from the chunk that happens to carry it, and a `ProfileChunk`'s
 * own `ts` is when the chunk was emitted — after the samples inside it.
 *
 * Reconstructing per chunk (`runningTs = chunk.ts` then accumulating) pushes
 * every chunk's samples forward by however long that chunk took to fill, which
 * silently misattributes them to the wrong window. It is invisible on
 * `--window=full`, where nothing is sliced, and wrong on every other mode.
 *
 * The fixture below is built so the two reconstructions disagree by more than
 * a rounding error: chunk 1 is emitted 300us after chunk 0, and carries 3
 * samples of 100us each that really belong to 1000-1300us.
 */
function fixture() {
  return {
    traceEvents: [
      { name: "Profile", ts: 1000, args: { data: { startTime: 1000 } } },
      {
        name: "ProfileChunk",
        ts: 1300,
        args: {
          data: {
            timeDeltas: [100, 100, 100],
            cpuProfile: {
              nodes: [
                { id: 1, callFrame: { functionName: "early", url: "a.js" } },
              ],
              samples: [1, 1, 1],
            },
          },
        },
      },
      {
        name: "ProfileChunk",
        ts: 1600,
        args: {
          data: {
            timeDeltas: [100, 100, 100],
            cpuProfile: {
              nodes: [
                { id: 2, callFrame: { functionName: "late", url: "a.js" } },
              ],
              samples: [2, 2, 2],
            },
          },
        },
      },
    ],
  };
}

test("samples are placed on one continuous clock from the Profile start", () => {
  // 1000-1300us is chunk 0's real span. Only `early` ran then.
  const { selfDeltaUs, totalDelta } = collectSelfTime(fixture(), 1000, 1300);

  assert.equal(totalDelta, 300, "the whole of chunk 0 belongs to this window");
  assert.equal(selfDeltaUs.get(1), 300);
  assert.equal(
    selfDeltaUs.get(2),
    undefined,
    "`late` ran after 1300us and must not appear",
  );
});

test("the second window gets the second chunk, not the first", () => {
  const { selfDeltaUs, totalDelta } = collectSelfTime(fixture(), 1301, 1600);

  assert.equal(totalDelta, 300);
  assert.equal(selfDeltaUs.get(2), 300);
  assert.equal(selfDeltaUs.get(1), undefined);
});

/**
 * The invariant that would have caught this without knowing the cause: sampled
 * time inside a window cannot meaningfully exceed the window. A per-chunk
 * reconstruction reported 88.84ms of samples inside a 36.31ms interaction
 * window on a real trace — 2.4x over — which is impossible and was the tell.
 *
 * The tolerance is one sampling interval, and it is real rather than slop: a
 * sample's delta measures the time BEFORE it, so a window boundary that falls
 * mid-interval necessarily captures a sample whose span started just outside.
 * With a 100us fixture interval the worst case is 100us of overshoot. The bug
 * this guards against overshoots by orders of magnitude more, so a tolerance
 * this tight still catches it.
 */
const SAMPLE_INTERVAL_US = 100;

test("sampled time in a window never meaningfully exceeds the window", () => {
  const windows = [
    [1000, 1300],
    [1000, 1600],
    [1200, 1500],
    [1450, 1600],
  ];
  for (const [start, end] of windows) {
    const { totalDelta } = collectSelfTime(fixture(), start, end);
    assert.ok(
      totalDelta <= end - start + SAMPLE_INTERVAL_US,
      `window ${start}-${end} (${end - start}us) attributed ${totalDelta}us`,
    );
  }
});

test("an unsliced window still sees every sample", () => {
  const { totalDelta } = collectSelfTime(
    fixture(),
    Number.NEGATIVE_INFINITY,
    Number.POSITIVE_INFINITY,
  );

  assert.equal(totalDelta, 600);
});

test("a trace with no Profile event falls back to the first chunk's ts", () => {
  // Older captures carry chunks without a Profile event. Dropping every sample
  // there would silently report an empty profile, so the fallback keeps them.
  const trace = fixture();
  trace.traceEvents = trace.traceEvents.filter((e) => e.name !== "Profile");

  const { totalDelta } = collectSelfTime(
    trace,
    Number.NEGATIVE_INFINITY,
    Number.POSITIVE_INFINITY,
  );

  assert.equal(totalDelta, 600);
});
