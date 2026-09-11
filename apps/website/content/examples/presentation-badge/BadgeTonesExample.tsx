"use client";

import { PretableBadge, type PretableBadgeTone } from "@pretable/react";

const badges: { tone?: PretableBadgeTone; label: string }[] = [
  { tone: "positive", label: "Approved" },
  { tone: "negative", label: "Risk" },
  { tone: "warning", label: "Watch" },
  { tone: "info", label: "Review" },
  { label: "Standard" },
];

export function BadgeTonesExample() {
  return (
    <dl
      aria-label="Badge tones"
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 120px), 1fr))",
        gap: 20,
        margin: 0,
        padding: 20,
        fontSize: 13,
      }}
    >
      {badges.map(({ tone, label }) => (
        <div key={label}>
          <dt style={{ marginBottom: 8 }}>{tone ?? "No tone"}</dt>
          <dd style={{ margin: 0 }}>
            <PretableBadge tone={tone}>{label}</PretableBadge>
          </dd>
        </div>
      ))}
    </dl>
  );
}
