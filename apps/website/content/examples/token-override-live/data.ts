export interface Product {
  id: string;
  name: string;
  category: string;
  price: number;
}

export const products: Product[] = [
  { id: "p1", name: "Desk lamp", category: "Lighting", price: 34 },
  { id: "p2", name: "Standing mat", category: "Ergonomics", price: 58 },
  { id: "p3", name: "Monitor arm", category: "Ergonomics", price: 89 },
  { id: "p4", name: "Cable tray", category: "Accessories", price: 12 },
];
