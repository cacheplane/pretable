const warned = new Set<string>();

/**
 * One console warning per key per process. The conditions that call this
 * describe consumer misconfiguration the engine cannot repair, and they are
 * evaluated on paths that run once per poll tick — a warning per emit under a
 * 2 s cadence would be a firehose that trains people to ignore it.
 *
 * @internal
 */
export function warnOnce(key: string, message: string): void {
  if (warned.has(key)) {
    return;
  }
  warned.add(key);
  console.warn(message);
}

/**
 * Forget every emitted key. Tests only — the set is module state, so without
 * this a second test asserting the same warning would see nothing.
 *
 * @internal
 */
export function resetDevWarnings(): void {
  warned.clear();
}
