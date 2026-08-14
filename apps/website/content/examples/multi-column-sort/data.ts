export interface Order {
  id: string;
  customer: string;
  region: string;
  status: string;
  total: number;
}

/**
 * Deliberately ties on `region` and `status` across several rows — a
 * single-column sort leaves those ties in source order, but adding `total`
 * as a second or third key breaks them, which is the whole point of a
 * shift-click cascade.
 */
export const orders: Order[] = [
  {
    id: "o1",
    customer: "Acme Co",
    region: "East",
    status: "Open",
    total: 4200,
  },
  {
    id: "o2",
    customer: "Bilt LLC",
    region: "West",
    status: "Shipped",
    total: 1800,
  },
  {
    id: "o3",
    customer: "Croma Inc",
    region: "East",
    status: "Open",
    total: 2600,
  },
  {
    id: "o4",
    customer: "Delta Bros",
    region: "Central",
    status: "Closed",
    total: 9100,
  },
  {
    id: "o5",
    customer: "Ester Group",
    region: "West",
    status: "Open",
    total: 3400,
  },
  {
    id: "o6",
    customer: "Foxglove",
    region: "East",
    status: "Shipped",
    total: 5300,
  },
  {
    id: "o7",
    customer: "Grove & Co",
    region: "Central",
    status: "Open",
    total: 1200,
  },
  {
    id: "o8",
    customer: "Halden Ltd",
    region: "West",
    status: "Shipped",
    total: 7600,
  },
  {
    id: "o9",
    customer: "Ionix",
    region: "East",
    status: "Closed",
    total: 3300,
  },
  {
    id: "o10",
    customer: "Juno Retail",
    region: "Central",
    status: "Open",
    total: 6700,
  },
  {
    id: "o11",
    customer: "Kestrel",
    region: "West",
    status: "Closed",
    total: 2100,
  },
  {
    id: "o12",
    customer: "Lumen Data",
    region: "Central",
    status: "Shipped",
    total: 4800,
  },
];
