/** Costs are deterministic accounted estimates for validated plain wire values. */
export function wireBytes(value: unknown): number {
  const steps = wireBytesSteps(value);
  for (;;) {
    const step = steps.next();
    if (step.done) return step.value;
  }
}
export class ResponseCapacityError extends RangeError {
  constructor(
    readonly capacity: "invalid-cost" | "metadata-capacity" = "invalid-cost",
  ) {
    super("response cost");
    this.name = "ResponseCapacityError";
  }
}

export function* wireStringLengthSteps(value: string): Generator<void, number> {
  let length = 2,
    work = 0;
  yield;
  for (let i = 0; i < value.length; i++) {
    if (++work === 64) {
      yield;
      work = 0;
    }
    const code = value.charCodeAt(i);
    if (code === 34 || code === 92) length += 2;
    else if (code < 32) length += [8, 9, 10, 12, 13].includes(code) ? 2 : 6;
    else if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(i + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        length += 2;
        i++;
      } else length += 6;
    } else length += code >= 0xdc00 && code <= 0xdfff ? 6 : 1;
  }
  return length;
}
function* jsonLength(value: unknown): Generator<void, number> {
  yield;
  if (value === undefined) return 9;
  if (value === null) return 4;
  if (typeof value === "string") return yield* wireStringLengthSteps(value);
  if (typeof value === "boolean") return value ? 4 : 5;
  if (typeof value === "number") return JSON.stringify(value).length;
  if (Array.isArray(value)) {
    let length = 2 + Math.max(0, value.length - 1);
    for (const child of value) length += yield* jsonLength(child);
    return length;
  }
  let length = 2,
    members = 0;
  for (const key of Object.keys(value as object)) {
    const child = (value as Record<string, unknown>)[key];
    if (members++) length++;
    length +=
      1 + (yield* wireStringLengthSteps(key)) + (yield* jsonLength(child));
  }
  return length;
}
/** Counts a JSON-shaped retained representation, including undefined-valued own
 * properties (which JSON would omit), without allocating a serialized string.
 * Only already validated immutable snapshots enter this traversal. */
export function* wireBytesSteps(value: unknown): Generator<void, number> {
  const bytes = 64 + 2 * (yield* jsonLength(value));
  if (!Number.isSafeInteger(bytes)) throw new RangeError("response cost");
  return bytes;
}
