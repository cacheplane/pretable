export interface Order {
  id: string;
  customer: string;
  region: string;
  amount: number;
}

const REGIONS = ["north", "south", "east", "west", "central"];

// Deliberately large and deterministic (no Math.random): big enough that a
// grouping change cannot settle inside one animation frame, so the rebuild
// really does publish multiple `rebuilding` slices instead of jumping
// straight to `ready` — see the note on the smaller custom-renderer example.
export const ORDER_COUNT = 150_000;

export const orders: Order[] = Array.from({ length: ORDER_COUNT }, (_, i) => ({
  id: `order-${i}`,
  customer: `Customer ${i % 5000}`,
  region: REGIONS[i % REGIONS.length]!,
  amount: ((i * 2654435761) % 100000) / 100,
}));
