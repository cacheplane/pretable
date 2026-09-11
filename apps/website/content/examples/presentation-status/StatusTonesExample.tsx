"use client";

import { PretableStatus, type PretableStatusTone } from "@pretable/react";

const states: { tone: PretableStatusTone; label: string }[] = [
  { tone: "positive", label: "Settled" },
  { tone: "negative", label: "Failed" },
  { tone: "warning", label: "Pending" },
  { tone: "info", label: "Processing" },
  { tone: "neutral", label: "Not started" },
];

export function StatusTonesExample() {
  return (
    <dl
      aria-label="Status tones"
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 120px), 1fr))",
        gap: 20,
        margin: 0,
        padding: 20,
        fontSize: 13,
      }}
    >
      {states.map(({ tone, label }) => (
        <div key={tone}>
          <dt style={{ marginBottom: 8 }}>{tone}</dt>
          <dd style={{ margin: 0 }}>
            <PretableStatus tone={tone}>{label}</PretableStatus>
          </dd>
        </div>
      ))}
    </dl>
  );
}
