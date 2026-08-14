export interface Product {
  id: string;
  name: string;
  category: string;
  price: number;
}

export const allProducts: Product[] = [
  { id: "p1", name: "Trail Runner 3", category: "Footwear", price: 128 },
  { id: "p2", name: "Alpine Shell Jacket", category: "Outerwear", price: 214 },
  { id: "p3", name: "Summit Daypack 22L", category: "Bags", price: 96 },
  { id: "p4", name: "Merino Base Layer", category: "Apparel", price: 58 },
  { id: "p5", name: "Trekking Poles Carbon", category: "Gear", price: 89 },
  { id: "p6", name: "Insulated Water Bottle", category: "Gear", price: 32 },
];
