"use client";

import Link from "next/link";

import { useControlState, type RateTier } from "./heroGrid/controlState";
import styles from "./topControlBar.module.css";

interface TopControlBarProps {
  ticksPerSec: number;
  p95Ms: number;
  fps: number;
}

const TIERS: { value: RateTier; label: string }[] = [
  { value: 10, label: "Calm" },
  { value: 60, label: "Active" },
  { value: 250, label: "Volatile" },
];

const eventsFormatter = new Intl.NumberFormat("en-US");

export function TopControlBar({
  ticksPerSec,
  p95Ms,
  fps,
}: TopControlBarProps) {
  const { ratePerSec, setRatePerSec, isPaused, setIsPaused } =
    useControlState();

  return (
    <div
      className={styles.bar}
      role="toolbar"
      aria-label="Market stream controls"
    >
      <div className={styles.left}>
        <Link className={styles.brandLink} href="/">
          <span aria-hidden="true" className={styles.dot}>
            ●
          </span>
          <span className={styles.brand}>pretable.ai</span>
        </Link>
      </div>
      <div className={styles.center}>
        <span className={styles.metric}>
          <strong>{eventsFormatter.format(ticksPerSec)}</strong> ticks/s
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
          aria-label={isPaused ? "Resume market" : "Pause market"}
          aria-pressed={isPaused}
          className={styles.iconBtn}
          onClick={() => setIsPaused(!isPaused)}
          type="button"
        >
          {isPaused ? "▶" : "⏸"}
        </button>
        <div
          aria-label="Market activity"
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
        <span aria-hidden="true" className={styles.linkSep} />
        <Link className={styles.link} href="/docs">
          /docs
        </Link>
        <a
          aria-label="GitHub"
          className={styles.link}
          href="https://github.com/cacheplane/pretable"
        >
          GitHub →
        </a>
      </div>
    </div>
  );
}
