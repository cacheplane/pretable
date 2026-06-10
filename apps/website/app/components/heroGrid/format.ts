// Uses U+2212 MINUS SIGN ("−") for negatives so numbers align in tabular-nums.
const MINUS = "−";
const usd = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });

export function fmtPrice(value: number): string {
  return value.toFixed(2);
}

export function fmtSignedUsd(value: number): string {
  if (value === 0) return "$0";
  const sign = value > 0 ? "+" : MINUS;
  return `${sign}$${usd.format(Math.abs(Math.round(value)))}`;
}

export function fmtPct(value: number): string {
  if (value === 0) return "0.00%"; // unsigned at zero, matching fmtSignedUsd("$0")
  const sign = value > 0 ? "+" : MINUS;
  return `${sign}${Math.abs(value).toFixed(2)}%`;
}

export function fmtCompactUsd(value: number): string {
  const m = value / 1_000_000;
  return `$${m.toFixed(1)}M`;
}
