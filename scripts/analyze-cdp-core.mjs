/**
 * Self time per profile node inside `[windowStartTs, windowEndTs]`.
 *
 * A trace's `timeDeltas` are ONE continuous stream beginning at the `Profile`
 * event's `startTime`: each delta is the gap from the previous SAMPLE, not from
 * the chunk carrying it. A `ProfileChunk`'s own `ts` is when the chunk was
 * EMITTED, which is after the samples inside it — chunk 0 of a real trace was
 * emitted 47ms after the profile started and carried exactly 47ms of deltas.
 *
 * This used to restart the clock at each chunk's `ts` and accumulate from
 * there, which pushed every chunk's samples forward by however long that chunk
 * took to fill. `--window=full` was unaffected because nothing is sliced there,
 * so the error only ever showed up in the windowed modes — where it reported
 * 88.84ms of samples inside a 36.31ms interaction window, which is impossible
 * and is the invariant the tests assert.
 */
export function collectSelfTime(trace, windowStartTs, windowEndTs) {
  const nodes = new Map();
  const selfDeltaUs = new Map();
  let totalDelta = 0;

  const profile = trace.traceEvents.find((ev) => ev.name === "Profile");
  const chunks = trace.traceEvents.filter((ev) => ev.name === "ProfileChunk");
  // Older captures carry chunks with no Profile event. Falling back to the
  // first chunk's ts keeps their samples rather than reporting an empty
  // profile; it is approximate by exactly the first chunk's fill time.
  let runningTs = profile?.args?.data?.startTime ?? chunks[0]?.ts ?? 0;

  for (const ev of chunks) {
    const data = ev.args?.data;
    const cpu = data?.cpuProfile;
    if (!cpu) continue;
    for (const n of cpu.nodes ?? []) nodes.set(n.id, n);
    const samples = cpu.samples ?? [];
    const deltas = data.timeDeltas ?? [];
    for (let i = 0; i < samples.length; i++) {
      runningTs += deltas[i] ?? 0;
      if (runningTs < windowStartTs || runningTs > windowEndTs) continue;
      const id = samples[i];
      const d = Math.max(0, deltas[i] ?? 0);
      selfDeltaUs.set(id, (selfDeltaUs.get(id) ?? 0) + d);
      totalDelta += d;
    }
  }

  return { nodes, selfDeltaUs, totalDelta };
}
