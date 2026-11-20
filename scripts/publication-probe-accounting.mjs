export function publicationTurn(kind) {
  return { kind, processingMs: 0, preparationMs: 0, commitMs: 0, commits: 0 };
}
export function recordPublicationCallback(turn, processingMs, commitMs) {
  const committed = commitMs ?? 0;
  if (
    !Number.isFinite(processingMs) ||
    !Number.isFinite(committed) ||
    processingMs < 0 ||
    committed < 0 ||
    committed > processingMs + 0.000001
  )
    throw new RangeError("Invalid publication callback accounting");
  turn.processingMs += processingMs;
  turn.preparationMs += Math.max(0, processingMs - committed);
  turn.commitMs += committed;
  if (commitMs !== undefined) turn.commits++;
}
export function preparationSamples(turns) {
  return turns
    .filter((turn) => turn.kind === "Timeout")
    .map((turn) => turn.preparationMs);
}
export function publicationGate(commitSamples, preparation) {
  const sorted = [...commitSamples].sort((a, b) => a - b);
  const row_model_commit_p95_ms = sorted[Math.floor(sorted.length * 0.95)] ?? 0;
  const rebuild_slice_max_ms = Math.max(0, ...preparation);
  return {
    row_model_commit_p95_ms,
    rebuild_slice_max_ms,
    limit_ms: 8,
    pass: row_model_commit_p95_ms <= 8 && rebuild_slice_max_ms <= 8,
  };
}
