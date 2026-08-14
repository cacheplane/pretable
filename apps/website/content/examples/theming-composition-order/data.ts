export interface Alert {
  id: string;
  rule: string;
  severity: "Info" | "Warning" | "Critical";
}

export const alerts: Alert[] = [
  { id: "a1", rule: "Disk usage > 80%", severity: "Warning" },
  { id: "a2", rule: "Node unreachable", severity: "Critical" },
  { id: "a3", rule: "Backup completed", severity: "Info" },
];
