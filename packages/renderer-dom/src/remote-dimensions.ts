/** Numeric guards shared by remote geometry only. */
export function finitePositive(value: number): void {
  if (!Number.isFinite(value) || value <= 0)
    throw new RangeError("Expected positive finite dimension");
}
export function safeExtent(value: number): void {
  if (!Number.isFinite(value) || value < 0 || value > Number.MAX_SAFE_INTEGER)
    throw new RangeError("Unsafe extent");
}
