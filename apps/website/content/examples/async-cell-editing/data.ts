export interface StockItem {
  id: string;
  item: string;
  quantity: number;
  inStock: boolean;
  priority: "low" | "medium" | "high";
  restockBy: string;
}

export const stockItems: StockItem[] = [
  {
    id: "s1",
    item: "Air filters",
    quantity: 24,
    inStock: true,
    priority: "high",
    restockBy: "2026-08-18",
  },
  {
    id: "s2",
    item: "Packing tape",
    quantity: 6,
    inStock: false,
    priority: "medium",
    restockBy: "2026-08-22",
  },
  {
    id: "s3",
    item: "Shipping labels",
    quantity: 120,
    inStock: true,
    priority: "low",
    restockBy: "2026-08-25",
  },
  {
    id: "s4",
    item: "Barcode scanners",
    quantity: 3,
    inStock: true,
    priority: "medium",
    restockBy: "2026-09-01",
  },
  {
    id: "s5",
    item: "Safety gloves",
    quantity: 40,
    inStock: false,
    priority: "high",
    restockBy: "2026-09-05",
  },
];
