export interface Customer {
  id: string;
  name: string;
  plan: string;
  mrr: number;
}

export const customers: Customer[] = [
  { id: "c1", name: "Acme Robotics", plan: "Enterprise", mrr: 4200 },
  { id: "c2", name: "Bluefin Labs", plan: "Growth", mrr: 980 },
  { id: "c3", name: "Cinder Systems", plan: "Growth", mrr: 1150 },
  { id: "c4", name: "Driftwood Studio", plan: "Starter", mrr: 190 },
  { id: "c5", name: "Everline Health", plan: "Enterprise", mrr: 5300 },
];
