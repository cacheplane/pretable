export interface Ticket {
  id: string;
  subject: string;
  assignee: string;
  priority: "Low" | "Medium" | "High";
}

export const tickets: Ticket[] = [
  {
    id: "t1",
    subject: "Login redirect loop",
    assignee: "Mara",
    priority: "High",
  },
  {
    id: "t2",
    subject: "Export button greyed out",
    assignee: "Devon",
    priority: "Medium",
  },
  {
    id: "t3",
    subject: "Typo on invoice PDF",
    assignee: "Mara",
    priority: "Low",
  },
  {
    id: "t4",
    subject: "Slow report generation",
    assignee: "Kai",
    priority: "Medium",
  },
];
