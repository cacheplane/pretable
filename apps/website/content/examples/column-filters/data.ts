export interface Order {
  id: string;
  customer: string;
  total: number;
  status: "open" | "shipped" | "cancelled";
  placedAt: string;
}

export const orders: Order[] = [
  {
    id: "o1",
    customer: "Ada Lovelace",
    total: 128,
    status: "open",
    placedAt: "2026-08-01",
  },
  {
    id: "o2",
    customer: "Grace Hopper",
    total: 412,
    status: "shipped",
    placedAt: "2026-08-03",
  },
  {
    id: "o3",
    customer: "Linus Torvalds",
    total: 76,
    status: "cancelled",
    placedAt: "2026-08-04",
  },
  {
    id: "o4",
    customer: "Margaret Hamilton",
    total: 205,
    status: "open",
    placedAt: "2026-08-06",
  },
  {
    id: "o5",
    customer: "Alan Turing",
    total: 340,
    status: "shipped",
    placedAt: "2026-08-07",
  },
  {
    id: "o6",
    customer: "Katherine Johnson",
    total: 58,
    status: "open",
    placedAt: "2026-08-08",
  },
  {
    id: "o7",
    customer: "Dennis Ritchie",
    total: 289,
    status: "shipped",
    placedAt: "2026-08-10",
  },
];
