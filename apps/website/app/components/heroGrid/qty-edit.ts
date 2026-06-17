export const GUARDRAIL_PCT = 7;

export function parseQty(raw: string): number {
  const cleaned = raw.replace(/[, ]/g, "").trim();
  if (!/^-?\d+$/.test(cleaned)) return Number.NaN;
  return Number.parseInt(cleaned, 10);
}

/** Returns `true` if acceptable, else a human error string. */
export function sanityCheckQty(qty: number, currentQty: number): true | string {
  if (!Number.isInteger(qty) || qty <= 0)
    return "Enter a whole number of shares";
  if (qty > currentQty * 10) return "Too large — over 10× current position";
  return true;
}

/** New single-name weight = newMktValue / (newMktValue + every other holding's mktValue). */
export function breachesGuardrail(args: {
  newMktValue: number;
  otherMktValue: number;
}): boolean {
  const nav = args.newMktValue + args.otherMktValue;
  if (nav <= 0) return false;
  return (args.newMktValue / nav) * 100 > GUARDRAIL_PCT;
}

/** Deterministic ~1-in-7 desk rejection, seeded by symbol+qty so demos/tests are stable. */
export function isDeskRejected(symbol: string, qty: number): boolean {
  let h = 2166136261;
  const key = `${symbol}:${qty}`;
  for (let i = 0; i < key.length; i += 1) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) % 7 === 0;
}
