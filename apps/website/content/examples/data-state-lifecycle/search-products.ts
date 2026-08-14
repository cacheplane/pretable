import { allProducts, type Product } from "./data";

export interface SearchResult {
  rows: Product[];
  total: number;
}

/**
 * Stands in for a remote search endpoint: a real 700ms delay so `stale` is
 * visible rather than instantaneous, and a deterministic failure — any query
 * containing "fail" — so the `error` phase is reachable without waiting on
 * real network flake.
 */
export async function searchProducts(query: string): Promise<SearchResult> {
  await new Promise((resolve) => setTimeout(resolve, 700));

  if (/fail/i.test(query)) {
    throw new Error("Search service unavailable");
  }

  const needle = query.trim().toLowerCase();
  const rows = needle
    ? allProducts.filter((product) =>
        product.name.toLowerCase().includes(needle),
      )
    : allProducts;

  return { rows, total: rows.length };
}
