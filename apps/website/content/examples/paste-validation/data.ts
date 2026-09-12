export interface InventoryItem {
  id: string;
  product: string;
  quantity: number;
}

export const initialInventory: InventoryItem[] = [
  { id: "item-1", product: "Notebooks", quantity: 10 },
  { id: "item-2", product: "Pens", quantity: 20 },
  { id: "item-3", product: "Folders", quantity: 30 },
];

export const mixedQuantities = "24\n-5\nabc";
export const correctedQuantities = "24\n25\n30";
