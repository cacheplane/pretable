export const benchAdapterFamilies = {
  pretable: "candidate",
  "ag-grid": "full-grid",
  tanstack: "virtualization-primitive",
  mui: "full-grid",
};

export function getBenchAdapterFamily(adapterId) {
  return benchAdapterFamilies[adapterId] ?? "unknown";
}
