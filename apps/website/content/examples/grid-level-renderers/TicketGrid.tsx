"use client";

import {
  PretableBadge,
  PretableStatus,
  PretableSurface,
  type PretableBadgeTone,
  type PretableStatusTone,
} from "@pretable/react";

import { columns } from "./columns";
import { tickets, type Ticket } from "./data";

const VIEWPORT_HEIGHT = 260;

const PRIORITY_TONE: Record<Ticket["priority"], PretableBadgeTone | undefined> =
  {
    high: "negative",
    medium: "warning",
    low: undefined,
  };

const STATUS_TONE: Record<Ticket["status"], PretableStatusTone> = {
  open: "info",
  "in-progress": "warning",
  resolved: "positive",
};

export function TicketGrid() {
  return (
    <div>
      <p style={{ margin: "0 0 8px", fontSize: 13 }}>
        <strong>Priority</strong> and <strong>Status</strong> are drawn by the
        surface's own <code>renderBodyCell</code>, not by a per-column{" "}
        <code>render</code> hook — useful when a wrapper component owns
        presentation for every column it renders, not just one.
      </p>
      <PretableSurface<Ticket>
        ariaLabel="Support tickets"
        columns={columns}
        getRowId={(row) => row.id}
        renderBodyCell={({ row, column, formattedValue }) => {
          if (column.id === "priority") {
            return (
              <PretableBadge tone={PRIORITY_TONE[row.priority]}>
                {row.priority}
              </PretableBadge>
            );
          }
          if (column.id === "status") {
            return (
              <PretableStatus tone={STATUS_TONE[row.status]}>
                {row.status}
              </PretableStatus>
            );
          }
          return formattedValue;
        }}
        renderHeaderCell={({ label }) => <strong>{label}</strong>}
        rows={tickets}
        viewportHeight={VIEWPORT_HEIGHT}
      />
    </div>
  );
}
