export interface Service extends Record<string, unknown> {
  id: string;
  name: string;
  team: string;
  status: "healthy" | "degraded" | "down";
  latencyMs: number;
}

const TEAMS = ["payments", "search", "identity", "growth", "core"];
const STATUSES = ["healthy", "degraded", "down"] as const;

// Deterministic 75-row fixture: stable across renders/SSR (no Math.random).
export const services: Service[] = Array.from({ length: 75 }, (_, i) => ({
  id: `svc-${i}`,
  name: `service-${String(i).padStart(2, "0")}`,
  team: TEAMS[i % TEAMS.length],
  status: STATUSES[i % STATUSES.length],
  latencyMs: 20 + ((i * 37) % 480),
}));
