import type { ScenarioDataset } from "@pretable-internal/scenario-data";

export type BenchAdapterProfile = "default" | "tuned";

export interface BenchAdapter {
  id: string;
  profile: BenchAdapterProfile;
  scenario: ScenarioDataset;
}
