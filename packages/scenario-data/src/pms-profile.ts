import type { ScenarioColumn, ScenarioRow } from "./index";

export const PMS_STRATEGIES = [
  "Long/Short Equity",
  "Event Driven",
  "Global Macro",
  "Credit",
  "Quant Equity",
  "Convertible Arb",
  "Merger Arb",
  "Distressed",
] as const;

export const PMS_SECTORS = [
  "Technology",
  "Health Care",
  "Financials",
  "Consumer Discretionary",
  "Industrials",
  "Energy",
  "Materials",
  "Utilities",
  "Real Estate",
  "Communication Services",
  "Consumer Staples",
] as const;

const books = ["Alpha", "Beta", "Gamma", "Delta", "Omega"] as const;
const assetClasses = ["Equity", "Bond", "Option", "Future", "ETF"] as const;
const regions = ["US", "EU", "UK", "JP", "APAC", "LATAM"] as const;
const currencies = ["USD", "EUR", "GBP", "JPY", "CHF"] as const;
const traders = ["akim", "bpatel", "cwu", "dnovak", "emorales", "fokafor"] as const;
const tickerPrefixes = [
  "AAP",
  "MSF",
  "NVD",
  "AMZ",
  "GOO",
  "MET",
  "BRK",
  "JPM",
  "XOM",
  "UNH",
  "LLY",
  "AVG",
  "TSM",
  "NVO",
  "ASM",
] as const;

/**
 * Sentences the notes column is stitched from. Three of eight mention
 * earnings so the `filter-text` probe ("earnings") hits a strict subset.
 */
const noteFragments = [
  "Trimmed into strength ahead of the earnings print.",
  "Position sized to the desk's sector limit.",
  "Hedged with index futures after the guidance cut.",
  "Watching earnings revisions for a re-rate.",
  "Liquidity thin below the 30-day average; work orders slowly.",
  "Core holding; add on any 5% pullback.",
  "Post-earnings drift still playing out.",
  "Rates sensitivity higher than the model implies.",
] as const;

const identityColumns: readonly ScenarioColumn[] = [
  { id: "ticker", header: "Ticker", wrap: false, widthPx: 110, pinned: "left", type: "text" },
  { id: "name", header: "Name", wrap: false, widthPx: 200, pinned: "left", type: "text" },
  { id: "strategy", header: "Strategy", wrap: false, widthPx: 150, type: "text" },
  { id: "sector", header: "Sector", wrap: false, widthPx: 170, type: "text" },
  { id: "book", header: "Book", wrap: false, widthPx: 100, type: "text" },
  { id: "assetClass", header: "Asset class", wrap: false, widthPx: 110, type: "text" },
  { id: "region", header: "Region", wrap: false, widthPx: 90, type: "text" },
  { id: "currency", header: "Ccy", wrap: false, widthPx: 80, type: "text" },
  { id: "trader", header: "Trader", wrap: false, widthPx: 110, type: "text" },
  { id: "notes", header: "Notes", wrap: true, widthPx: 260, type: "text" },
];

const numericColumnIds = [
  "quantity",
  "lastPrice",
  "prevClose",
  "avgCost",
  "marketValue",
  "unrealizedPnl",
  "dayPnl",
  "dayChangePct",
  "weightPct",
  "costBasis",
  "realizedPnl",
  "mtdPnl",
  "ytdPnl",
  "beta",
  "delta",
  "gamma",
  "vega",
  "theta",
  "dv01",
  "var95",
  "grossExposure",
  "netExposure",
  "leverage",
  "impliedVol",
  "bidPrice",
  "askPrice",
  "volume",
  "adv30d",
  "daysToLiquidate",
  "lotCount",
] as const;

export const pmsColumns: readonly ScenarioColumn[] = Object.freeze([
  ...identityColumns,
  ...numericColumnIds.map(
    (id): ScenarioColumn => ({
      id,
      header: humanize(id),
      wrap: false,
      widthPx: 110,
      type: "number",
    }),
  ),
]);

/** The four columns a price tick ripples into. Pure function of the row. */
export function derivePmsRow(row: ScenarioRow): Readonly<Record<string, number>> {
  const quantity = Number(row.quantity);
  const lastPrice = Number(row.lastPrice);
  const prevClose = Number(row.prevClose);
  const avgCost = Number(row.avgCost);
  const marketValue = round(quantity * lastPrice, 2);
  return Object.freeze({
    marketValue,
    unrealizedPnl: round(marketValue - round(quantity * avgCost, 2), 2),
    dayPnl: round(quantity * (lastPrice - prevClose), 2),
    dayChangePct: round(((lastPrice - prevClose) / prevClose) * 100, 4),
  });
}

export function buildPmsRows(seed: number, count: number): readonly ScenarioRow[] {
  return Array.from({ length: count }, (_, rowIndex) => buildPmsRow(seed, rowIndex));
}

function buildPmsRow(seed: number, rowIndex: number): ScenarioRow {
  // Seeded per row so row i is identical at every scale.
  const random = mulberry32((Math.imul(seed, 1_000_003) + rowIndex) >>> 0);
  const pick = <T,>(pool: readonly T[]) => pool[Math.floor(random() * pool.length)]!;
  const between = (lo: number, hi: number, decimals: number) =>
    round(lo + random() * (hi - lo), decimals);

  const strategy = PMS_STRATEGIES[rowIndex % PMS_STRATEGIES.length]!;
  const sector = PMS_SECTORS[Math.floor(rowIndex / PMS_STRATEGIES.length) % PMS_SECTORS.length]!;
  const prefix = pick(tickerPrefixes);
  const quantity = Math.floor(between(100, 250_000, 0));
  const lastPrice = between(1, 900, 2);
  const prevClose = round(lastPrice * (1 + between(-0.05, 0.05, 4)), 2);
  const avgCost = round(lastPrice * (1 + between(-0.3, 0.3, 4)), 2);
  const fragmentCount = 1 + Math.floor(random() * 4);
  const notes = Array.from({ length: fragmentCount }, () => pick(noteFragments)).join(" ");

  const row: ScenarioRow = {
    id: `S8-row-${rowIndex}`,
    ticker: `${prefix}${rowIndex}`,
    name: `${prefix} Holdings ${rowIndex}`,
    strategy,
    sector,
    book: pick(books),
    assetClass: pick(assetClasses),
    region: pick(regions),
    currency: pick(currencies),
    trader: pick(traders),
    notes,
    quantity,
    lastPrice,
    prevClose,
    avgCost,
    marketValue: 0,
    unrealizedPnl: 0,
    dayPnl: 0,
    dayChangePct: 0,
    weightPct: between(0, 4, 4),
    costBasis: round(quantity * avgCost, 2),
    realizedPnl: between(-500_000, 500_000, 2),
    mtdPnl: between(-800_000, 800_000, 2),
    ytdPnl: between(-4_000_000, 4_000_000, 2),
    beta: between(-0.5, 2, 3),
    delta: between(-1, 1, 4),
    gamma: between(0, 0.2, 4),
    vega: between(0, 5_000, 2),
    theta: between(-2_000, 0, 2),
    dv01: between(0, 20_000, 2),
    var95: between(0, 2_000_000, 2),
    grossExposure: between(0, 50_000_000, 2),
    netExposure: between(-25_000_000, 25_000_000, 2),
    leverage: between(0.5, 4, 2),
    impliedVol: between(0.1, 1.2, 4),
    bidPrice: round(lastPrice * 0.999, 2),
    askPrice: round(lastPrice * 1.001, 2),
    volume: Math.floor(between(1_000, 50_000_000, 0)),
    adv30d: Math.floor(between(1_000, 60_000_000, 0)),
    daysToLiquidate: between(0.1, 30, 1),
    lotCount: Math.floor(between(1, 40, 0)),
  };
  return Object.assign(row, derivePmsRow(row));
}

function humanize(id: string) {
  return id.replace(/([A-Z])/g, " $1").replace(/^./, (c) => c.toUpperCase());
}

function round(value: number, decimals: number) {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

function mulberry32(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let value = Math.imul(state ^ (state >>> 15), 1 | state);
    value ^= value + Math.imul(value ^ (value >>> 7), 61 | value);
    return ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296;
  };
}
