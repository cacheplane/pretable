export interface Instrument {
  id: string;
  symbol: string;
  name: string;
  sector: string;
  price: number;
  note: string;
}

export const instruments: Instrument[] = [
  {
    id: "i1",
    symbol: "NVDA",
    name: "NVIDIA",
    sector: "Technology",
    price: 118.32,
    note: "Core position",
  },
  {
    id: "i2",
    symbol: "MSFT",
    name: "Microsoft",
    sector: "Technology",
    price: 421.9,
    note: "Trimming",
  },
  {
    id: "i3",
    symbol: "LLY",
    name: "Eli Lilly",
    sector: "Healthcare",
    price: 812.55,
    note: "Watching earnings",
  },
  {
    id: "i4",
    symbol: "JPM",
    name: "JPMorgan Chase",
    sector: "Financials",
    price: 214.07,
    note: "Core position",
  },
  {
    id: "i5",
    symbol: "XOM",
    name: "Exxon Mobil",
    sector: "Energy",
    price: 117.44,
    note: "Hedge",
  },
  {
    id: "i6",
    symbol: "UNH",
    name: "UnitedHealth",
    sector: "Healthcare",
    price: 498.2,
    note: "New entry",
  },
];
