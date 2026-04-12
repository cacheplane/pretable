export type BenchAdapterId =
  | "pretable"
  | "ag-grid"
  | "tanstack"
  | "mui"
  | "glide"
  | "handsontable";

export type BenchAdapterFamily =
  | "candidate"
  | "full-grid"
  | "virtualization-primitive"
  | "unknown";

export declare const benchAdapterFamilies: Record<
  BenchAdapterId,
  BenchAdapterFamily
>;

export declare function getBenchAdapterFamily(
  adapterId: BenchAdapterId,
): BenchAdapterFamily;
