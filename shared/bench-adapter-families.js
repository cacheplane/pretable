export const benchAdapterFamilies = {
  pretable: "candidate",
  "ag-grid": "full-grid",
  tanstack: "virtualization-primitive",
  mui: "full-grid",
  glide: "full-grid",
  handsontable: "full-grid",
};

export function getBenchAdapterFamily(adapterId) {
  return benchAdapterFamilies[adapterId] ?? "unknown";
}
