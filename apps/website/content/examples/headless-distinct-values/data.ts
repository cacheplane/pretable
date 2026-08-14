export interface Contact {
  id: string;
  name: string;
  team: string;
}

const TEAMS = [
  "payments",
  "search",
  "identity",
  "growth",
  "platform",
  "data",
  "design",
  "support",
  "sales",
  "marketing",
  "security",
  "mobile",
];

// Deterministic 300-row fixture: stable across renders/SSR (no Math.random).
export const contacts: Contact[] = Array.from({ length: 300 }, (_, i) => ({
  id: `contact-${i}`,
  name: `Contact ${i}`,
  team: TEAMS[i % TEAMS.length]!,
}));
