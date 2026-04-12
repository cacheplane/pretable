export const benchAdapterFamilies = {
  pretable: "candidate",
  "gridalpha": "full-grid",
  gridbeta: "virtualization-primitive",
  gridgamma: "full-grid",
  glide: "full-grid",
  handsontable: "full-grid",
};

export function getBenchAdapterFamily(adapterId) {
  return benchAdapterFamilies[adapterId] ?? "unknown";
}
