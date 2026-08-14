export interface Ticket {
  id: string;
  subject: string;
  priority: "low" | "medium" | "high";
  status: "open" | "in-progress" | "resolved";
}

export const tickets: Ticket[] = [
  {
    id: "t1",
    subject: "Login redirect loop",
    priority: "high",
    status: "open",
  },
  {
    id: "t2",
    subject: "Export button disabled",
    priority: "medium",
    status: "in-progress",
  },
  {
    id: "t3",
    subject: "Typo in invoice footer",
    priority: "low",
    status: "resolved",
  },
  {
    id: "t4",
    subject: "Slow dashboard load",
    priority: "high",
    status: "in-progress",
  },
  { id: "t5", subject: "Dark mode contrast", priority: "low", status: "open" },
];
