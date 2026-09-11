"use client";

import { PretableEntity } from "@pretable/react";

export function EntityLinesExample() {
  return (
    <dl
      aria-label="Entity line variants"
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 120px), 1fr))",
        gap: 20,
        margin: 0,
        padding: 20,
        fontSize: 13,
      }}
    >
      <div>
        <dt style={{ marginBottom: 8 }}>Primary and secondary</dt>
        <dd style={{ margin: 0 }}>
          <PretableEntity primary="NVDA" secondary="NVIDIA Corp." />
        </dd>
      </div>
      <div>
        <dt style={{ marginBottom: 8 }}>Primary only</dt>
        <dd style={{ margin: 0 }}>
          <PretableEntity primary="MSFT" />
        </dd>
      </div>
    </dl>
  );
}
