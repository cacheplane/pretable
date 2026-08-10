import type { PretableColumn, PretableRow } from "../../types";

export interface OracleHolding extends PretableRow {
  id: string;
  sector: string | number | null;
  analyst: string;
  quantity: number;
  label: string;
}

/** Shared edge data for characterization now and randomized differential tests later. */
export const ORACLE_HOLDINGS: readonly OracleHolding[] = [
  {
    id: "__group__:sector=s:Tech%2FGrowth",
    sector: "Tech/Growth",
    analyst: "Ada=One",
    quantity: 20,
    label: "item 10",
  },
  {
    id: "h2",
    sector: "Tech/Growth",
    analyst: "Ada=One",
    quantity: 20,
    label: "Item 2",
  },
  {
    id: "h3",
    sector: "Energy%Core",
    analyst: "Bob/Two",
    quantity: 5,
    label: "item 1",
  },
  {
    id: "h4",
    sector: "Energy%Core",
    analyst: "Ada=One",
    quantity: 40,
    label: "ITEM 2",
  },
  {
    id: "h5",
    sector: null,
    analyst: "Bob/Two",
    quantity: 1,
    label: "item 20",
  },
  {
    id: "h6",
    sector: undefined as unknown as null,
    analyst: "Bob/Two",
    quantity: 100,
    label: "item 3",
  },
];

export const ORACLE_COLUMNS: readonly PretableColumn<OracleHolding>[] = [
  { id: "sector", header: "Sector" },
  { id: "analyst", header: "Analyst" },
  { id: "quantity", header: "Quantity", type: "number", aggregate: "sum" },
  { id: "label", header: "Label", type: "text" },
];
