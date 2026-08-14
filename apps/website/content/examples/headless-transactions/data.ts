export interface Task {
  id: string;
  title: string;
  status: "open" | "done";
}

// Deterministic fixture: stable across renders/SSR (no Math.random).
export const tasks: Task[] = [
  { id: "task-1", title: "Draft proposal", status: "open" },
  { id: "task-2", title: "Review budget", status: "open" },
  { id: "task-3", title: "Ship changelog", status: "done" },
  { id: "task-4", title: "Onboard analyst", status: "open" },
];
