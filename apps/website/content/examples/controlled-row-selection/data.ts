export interface Order {
  id: string;
  customer: string;
  status: "Open" | "Shipped";
}

export const initialOrders: Order[] = [
  { id: "ORD-101", customer: "Acme", status: "Open" },
  { id: "ORD-102", customer: "Beacon", status: "Open" },
  { id: "ORD-103", customer: "Cedar", status: "Open" },
];
