export interface Order {
  id: string;
  sku: string;
  qty: number;
  total: number;
}

export const orders: Order[] = [
  { id: "o1", sku: "007-2200", qty: 4, total: 128.5 },
  { id: "o2", sku: "014-9910", qty: 1, total: 42 },
  { id: "o3", sku: "022-3301", qty: 12, total: 613.2 },
  { id: "o4", sku: "031-0087", qty: 3, total: 87.75 },
];
