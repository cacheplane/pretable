"use client";

import { PretableIconButton } from "@pretable/react";
import { useState } from "react";

export function PinViewButton() {
  const [pinned, setPinned] = useState(false);

  return (
    <div style={{ padding: 20, fontSize: 13 }}>
      <p style={{ margin: "0 0 16px" }}>
        Pin “Open orders” for quick access. Use Enter or Space on the button.
      </p>
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <PretableIconButton
          aria-label="Pin view"
          aria-pressed={pinned}
          site="saved-view-pin"
          onClick={() => setPinned((value) => !value)}
        >
          <svg
            aria-hidden="true"
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill={pinned ? "currentColor" : "none"}
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M8 3h8l-1 6 4 4v2H5v-2l4-4-1-6Z" />
            <path d="M12 15v6" />
          </svg>
        </PretableIconButton>
        <span>Open orders</span>
      </div>
      <p role="status" style={{ margin: "16px 0 0" }}>
        {pinned ? "View pinned to quick access." : "View is not pinned."}
      </p>
    </div>
  );
}
