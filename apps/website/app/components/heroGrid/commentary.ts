import type { PositionFlag } from "./types";

export interface CommentaryScript {
  symbol: string;
  flag: PositionFlag;
  /** Sentence chunks streamed in order, ~1 per Phase-2 commentary event. */
  chunks: string[];
}

/**
 * Pre-authored analyst notes keyed by symbol. Synthetic and illustrative.
 * Chunked at sentence boundaries so streaming changes row height a handful of
 * times per holding (controlled cadence), not per character.
 */
export const COMMENTARY: CommentaryScript[] = [
  {
    symbol: "NVDA",
    flag: "trim",
    chunks: [
      "Up on hyperscaler capex headlines.",
      " Position now 8.4% of book — above the 7% single-name guardrail.",
    ],
  },
  {
    symbol: "PFE",
    flag: "hold",
    chunks: [
      "Trial readout miss reported minutes ago.",
      " Dividend + pipeline thesis intact; drawdown inside the 1.5σ band.",
    ],
  },
  {
    symbol: "MSFT",
    flag: "watch",
    chunks: [
      "Correlates 0.71 with NVDA.",
      " Combined AI-compute exposure 15.3% — watch if trimming into the same theme.",
    ],
  },
  {
    symbol: "TSLA",
    flag: "watch",
    chunks: [
      "Recovered intraday but red vs cost basis.",
      " Beta to book is 1.8 — largest single contributor to today's vol.",
    ],
  },
  {
    symbol: "XOM",
    flag: "hold",
    chunks: [
      "Tracking crude + sector rotation.",
      " Unrealized still positive; no action vs target weight.",
    ],
  },
  {
    symbol: "META",
    flag: "watch",
    chunks: [
      "Momentum strong into the print.",
      " Options skew rich; size is already at the model cap.",
    ],
  },
  {
    symbol: "JPM",
    flag: "hold",
    chunks: [
      "Net-interest-income guide reaffirmed.",
      " Defensive ballast for the book; hold at weight.",
    ],
  },
  {
    symbol: "UNH",
    flag: "risk",
    chunks: [
      "Headline risk on a regulatory probe.",
      " Flagged for review — drawdown breached the 2σ stop band.",
    ],
  },
];
