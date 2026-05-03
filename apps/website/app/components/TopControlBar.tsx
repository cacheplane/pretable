"use client";

import { useControlState, type RateTier } from "./heroGrid/controlState";
import styles from "./topControlBar.module.css";

interface TopControlBarProps {
  eventsPerSec: number;
  p95Ms: number;
  fps: number;
}

const TIERS: { value: RateTier; label: string }[] = [
  { value: 250, label: "Light" },
  { value: 1000, label: "Production" },
  { value: 5000, label: "Heavy" },
  { value: 25000, label: "Extreme" },
];

const eventsFormatter = new Intl.NumberFormat("en-US");

export function TopControlBar({
  eventsPerSec,
  p95Ms,
  fps,
}: TopControlBarProps) {
  const { ratePerSec, setRatePerSec, isPaused, setIsPaused } =
    useControlState();

  return (
    <div
      className={styles.bar}
      role="toolbar"
      aria-label="Grid stream controls"
    >
      <div className={styles.left}>
        <span aria-hidden="true" className={styles.dot}>
          ●
        </span>
        <span className={styles.brand}>pretable.ai</span>
        <span aria-hidden="true" className={styles.sep}>
          ·
        </span>
        <span>events.stream</span>
      </div>
      <div className={styles.center}>
        <span className={styles.metric}>
          <strong>{eventsFormatter.format(eventsPerSec)}</strong> ev/s
        </span>
        <span className={styles.metric}>
          <strong>{p95Ms > 0 ? p95Ms.toFixed(1) : "—"}</strong> ms p95
        </span>
        <span className={styles.metric}>
          <strong>{fps}</strong> fps
        </span>
      </div>
      <div className={styles.right}>
        <button
          aria-label={isPaused ? "Resume stream" : "Pause stream"}
          aria-pressed={isPaused}
          className={styles.iconBtn}
          onClick={() => setIsPaused(!isPaused)}
          type="button"
        >
          {isPaused ? "▶" : "⏸"}
        </button>
        <div
          aria-label="Stream rate"
          className={styles.tierGroup}
          role="radiogroup"
        >
          {TIERS.map((tier) => (
            <button
              aria-checked={ratePerSec === tier.value}
              className={styles.tier}
              data-active={ratePerSec === tier.value}
              key={tier.value}
              onClick={() => setRatePerSec(tier.value)}
              role="radio"
              type="button"
            >
              {tier.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
