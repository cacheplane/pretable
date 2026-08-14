export interface Task {
  id: string;
  title: string;
  // 1 = Low, 2 = Medium, 3 = High.
  priority: number;
}

export const tasks: Task[] = [
  { id: "t1", title: "Draft proposal", priority: 2 },
  { id: "t2", title: "Review PR #482", priority: 3 },
  { id: "t3", title: "Update changelog", priority: 1 },
  { id: "t4", title: "Fix flaky test", priority: 3 },
];
