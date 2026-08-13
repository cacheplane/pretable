export interface Task {
  id: string;
  title: string;
  owner: string;
  status: string;
}

export const tasks: Task[] = [
  {
    id: "t1",
    title: "Ship dark-mode toggle",
    owner: "Priya",
    status: "In review",
  },
  {
    id: "t2",
    title: "Audit checkbox contrast",
    owner: "Jae",
    status: "Done",
  },
  {
    id: "t3",
    title: "Wire density switch",
    owner: "Sam",
    status: "Todo",
  },
  {
    id: "t4",
    title: "Write theming docs",
    owner: "Priya",
    status: "In review",
  },
];
