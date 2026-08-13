export interface Shipment {
  id: string;
  lane: string;
  carrier: string;
  status: string;
}

export const shipments: Shipment[] = [
  {
    id: "s1",
    lane: "PDX → SEA",
    carrier: "Meridian Freight",
    status: "On time",
  },
  { id: "s2", lane: "SEA → YVR", carrier: "Cascade Line", status: "Delayed" },
  {
    id: "s3",
    lane: "PDX → BOI",
    carrier: "Meridian Freight",
    status: "On time",
  },
  {
    id: "s4",
    lane: "BOI → SLC",
    carrier: "Summit Logistics",
    status: "On time",
  },
];
