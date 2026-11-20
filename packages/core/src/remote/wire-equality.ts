/** Structural equality for validated immutable wire snapshots. Object order is
 * irrelevant; missing/undefined, signed zero and array/object shape are distinct.
 * Avoid whole-body signature strings while allowing retained overlap checks to
 * yield within a large row or aggregate value. */
export function* equalWireSteps(
  a: unknown,
  b: unknown,
): Generator<void, boolean> {
  yield;
  if (typeof a !== typeof b) return false;
  if (typeof a === "string" && typeof b === "string") {
    if (a.length !== b.length) return false;
    for (let offset = 0; offset < a.length; offset += 4096) {
      yield;
      if (a.slice(offset, offset + 4096) !== b.slice(offset, offset + 4096))
        return false;
    }
    return true;
  }
  if (
    a === null ||
    b === null ||
    typeof a !== "object" ||
    typeof b !== "object"
  )
    return Object.is(a, b);
  if (a === b) return true;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const keys = Object.keys(a);
  if (keys.length !== Object.keys(b).length) return false;
  for (const key of keys) {
    yield;
    if (
      !Object.hasOwn(b, key) ||
      !(yield* equalWireSteps(
        (a as Record<string, unknown>)[key],
        (b as Record<string, unknown>)[key],
      ))
    )
      return false;
  }
  return true;
}
