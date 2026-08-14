export interface Product extends Record<string, unknown> {
  id: string;
  sku: string;
  name: string;
  category: string;
  unitsInStock: number;
}

export const products: Product[] = [
  {
    id: "p1",
    sku: "WH-1001",
    name: "Wireless headphones",
    category: "Audio",
    unitsInStock: 84,
  },
  {
    id: "p2",
    sku: "SP-2044",
    name: "Bluetooth speaker",
    category: "Audio",
    unitsInStock: 37,
  },
  {
    id: "p3",
    sku: "KB-3312",
    name: "Mechanical keyboard",
    category: "Peripherals",
    unitsInStock: 52,
  },
  {
    id: "p4",
    sku: "MS-3390",
    name: "Wireless mouse",
    category: "Peripherals",
    unitsInStock: 118,
  },
  {
    id: "p5",
    sku: "MN-4501",
    name: "27-inch monitor",
    category: "Displays",
    unitsInStock: 21,
  },
  {
    id: "p6",
    sku: "MN-4520",
    name: "Ultrawide monitor",
    category: "Displays",
    unitsInStock: 9,
  },
  {
    id: "p7",
    sku: "DK-5810",
    name: "Laptop dock",
    category: "Accessories",
    unitsInStock: 46,
  },
  {
    id: "p8",
    sku: "CB-5899",
    name: "USB-C cable, 2m",
    category: "Accessories",
    unitsInStock: 260,
  },
];
