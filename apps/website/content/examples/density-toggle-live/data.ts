export interface LogLine {
  id: string;
  time: string;
  service: string;
  message: string;
}

export const logLines: LogLine[] = [
  { id: "l1", time: "09:14:02", service: "api", message: "GET /orders 200" },
  {
    id: "l2",
    time: "09:14:03",
    service: "worker",
    message: "job:export queued",
  },
  { id: "l3", time: "09:14:05", service: "api", message: "POST /orders 201" },
  { id: "l4", time: "09:14:06", service: "worker", message: "job:export done" },
  { id: "l5", time: "09:14:09", service: "api", message: "GET /orders/42 200" },
];
