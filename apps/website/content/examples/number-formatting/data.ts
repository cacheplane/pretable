export interface Order extends Record<string, unknown> {
  id: string;
  region: string;
  channel: string;
  revenue: number;
  refunds: number;
  marginPct: number;
}

export const orders: Order[] = [
  {
    id: "o1",
    region: "Northeast",
    channel: "Retail",
    revenue: 48200,
    refunds: -1250,
    marginPct: 0.212,
  },
  {
    id: "o2",
    region: "Northeast",
    channel: "Wholesale",
    revenue: 91500,
    refunds: -3100,
    marginPct: 0.164,
  },
  {
    id: "o3",
    region: "Northeast",
    channel: "Online",
    revenue: 27800,
    refunds: -420,
    marginPct: 0.288,
  },
  {
    id: "o4",
    region: "Midwest",
    channel: "Retail",
    revenue: 33400,
    refunds: -900,
    marginPct: 0.171,
  },
  {
    id: "o5",
    region: "Midwest",
    channel: "Wholesale",
    revenue: 62700,
    refunds: -2650,
    marginPct: 0.139,
  },
  {
    id: "o6",
    region: "Midwest",
    channel: "Online",
    revenue: 18900,
    refunds: -310,
    marginPct: 0.254,
  },
  {
    id: "o7",
    region: "South",
    channel: "Retail",
    revenue: 52600,
    refunds: -1780,
    marginPct: 0.198,
  },
  {
    id: "o8",
    region: "South",
    channel: "Wholesale",
    revenue: 74300,
    refunds: -2990,
    marginPct: 0.152,
  },
  {
    id: "o9",
    region: "South",
    channel: "Online",
    revenue: 24100,
    refunds: -360,
    marginPct: 0.301,
  },
  {
    id: "o10",
    region: "West",
    channel: "Retail",
    revenue: 61200,
    refunds: -2040,
    marginPct: 0.183,
  },
  {
    id: "o11",
    region: "West",
    channel: "Wholesale",
    revenue: 88900,
    refunds: -3550,
    marginPct: 0.147,
  },
  {
    id: "o12",
    region: "West",
    channel: "Online",
    revenue: 31700,
    refunds: -480,
    marginPct: 0.275,
  },
];
