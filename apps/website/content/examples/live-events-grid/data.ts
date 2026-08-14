export interface EventRow {
  id: string;
  timestamp: string;
  message: string;
}

export const events: EventRow[] = [
  {
    id: "e1",
    timestamp: "2026-08-12T09:14:00Z",
    message: "Deployment 482 shipped to production",
  },
  {
    id: "e2",
    timestamp: "2026-08-12T09:16:00Z",
    message: "Cache hit rate dropped below 90%",
  },
  {
    id: "e3",
    timestamp: "2026-08-12T09:19:00Z",
    message: "Autoscaler added 2 web workers",
  },
  {
    id: "e4",
    timestamp: "2026-08-12T09:24:00Z",
    message: "Cache hit rate recovered to 96%",
  },
  {
    id: "e5",
    timestamp: "2026-08-12T09:31:00Z",
    message: "Nightly backup completed in 4m12s",
  },
];
