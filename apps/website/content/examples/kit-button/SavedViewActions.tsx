"use client";

import { PretableButton } from "@pretable/react";
import { useState } from "react";

export function SavedViewActions() {
  const [applied, setApplied] = useState(false);

  return (
    <div style={{ padding: 20, fontSize: 13 }}>
      <p style={{ margin: "0 0 16px" }}>
        Apply the saved “Open orders” view, then reset to all orders.
      </p>
      <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
        <PretableButton
          variant="ghost"
          site="saved-view-apply"
          disabled={applied}
          onClick={() => setApplied(true)}
        >
          Apply saved view
        </PretableButton>
        <PretableButton
          variant="link"
          site="saved-view-reset"
          disabled={!applied}
          onClick={() => setApplied(false)}
        >
          Reset view
        </PretableButton>
      </div>
      <p role="status" style={{ margin: "16px 0 0" }}>
        Current view: {applied ? "Open orders" : "All orders"}
      </p>
    </div>
  );
}
