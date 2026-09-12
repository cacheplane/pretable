export interface Order extends Record<string, unknown> {
  id: string;
  customer: string;
  total: number;
}

export const orders: Order[] = [
  { id: "ORD-101", customer: "Acme, Inc.", total: 1234.5 },
  { id: "ORD-102", customer: 'Beacon "Labs"', total: 99 },
  { id: "ORD-103", customer: "Cedar", total: 0 },
];
