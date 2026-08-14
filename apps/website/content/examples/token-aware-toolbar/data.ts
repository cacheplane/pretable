export interface Metric {
  id: string;
  name: string;
  value: string;
}

export const metrics: Metric[] = [
  { id: "m1", name: "Latency p50", value: "112ms" },
  { id: "m2", name: "Latency p99", value: "480ms" },
  { id: "m3", name: "Error rate", value: "0.4%" },
];
