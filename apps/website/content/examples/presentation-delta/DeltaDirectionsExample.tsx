"use client";

import { PretableDelta } from "@pretable/react";

const money = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  signDisplay: "exceptZero",
});

const changes = [
  { label: "Gain", value: 1250.5 },
  { label: "Loss", value: -640.75 },
  { label: "Unchanged", value: 0 },
];

export function DeltaDirectionsExample() {
  return (
    <dl
      aria-label="Signed change directions"
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 120px), 1fr))",
        gap: 20,
        margin: 0,
        padding: 20,
        fontSize: 13,
      }}
    >
      {changes.map(({ label, value }) => (
        <div key={label}>
          <dt style={{ marginBottom: 8 }}>{label}</dt>
          <dd style={{ margin: 0 }}>
            <PretableDelta value={value}>{money.format(value)}</PretableDelta>
          </dd>
        </div>
      ))}
    </dl>
  );
}
