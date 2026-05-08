#!/usr/bin/env python3
"""Aggregate S5 updates summaries by adapter × update rate.

Outputs:
- Per-metric markdown tables (median across repeats)
- Operating envelope per adapter (highest rate where frame_p95 ≤ 16ms AND
  long_tasks_count == 0 — the H13 absolute thresholds)
- Honest summary lines for the memo
"""
import json
import statistics
import sys
from pathlib import Path
from collections import defaultdict

STATUS_DIR = Path("status")
ADAPTERS = ["pretable", "ag-grid", "tanstack", "mui"]
ALL_RATES = [100, 500, 1000, 5000, 10000, 25000]
METRICS = [
    "scroll_frame_p95_ms",
    "frame_max_ms",
    "frame_budget_overruns_count",
    "long_tasks_count",
    "long_tasks_max_ms",
    "long_tasks_ms",
    "streaming_cls",
    "scroll_position_drift_px",
    "visible_row_count_drift",
]


def parse_rate(notes):
    for n in notes or []:
        if n.startswith("update rate per sec: "):
            try:
                return int(n.split(":", 1)[1].strip())
            except Exception:
                return None
    return None


def fmt(value):
    if value is None:
        return "—"
    if isinstance(value, float):
        if abs(value) < 0.001 and value != 0:
            return f"{value:.4g}"
        if abs(value) < 100:
            return f"{value:.1f}"
        return f"{value:.0f}"
    return str(value)


def main() -> int:
    # rate -> adapter -> list of metrics dicts
    buckets = defaultdict(lambda: defaultdict(list))

    files = sorted(
        STATUS_DIR.glob("chromium-*-default-s5-hypothesis-updates-*.summary.json")
    )
    for path in files:
        try:
            data = json.loads(path.read_text())
        except Exception:
            continue
        if data.get("status") != "completed":
            continue
        adapter = data.get("adapterId")
        if adapter not in ADAPTERS:
            continue
        rate = parse_rate(data.get("notes"))
        if rate is None:
            continue
        buckets[rate][adapter].append(data.get("metrics") or {})

    rates_seen = sorted(r for r in buckets if r in ALL_RATES)
    if not rates_seen:
        print("(no data yet)")
        return 0

    # Per-metric markdown tables.
    for metric in METRICS:
        sample_count = (
            len(buckets[rates_seen[0]].get("pretable", [])) if rates_seen else 0
        )
        print(f"\n### `{metric}` (median of {sample_count} repeats)\n")
        print("| Rate | " + " | ".join(ADAPTERS) + " |")
        print("|------|" + "------|" * len(ADAPTERS))
        for rate in rates_seen:
            row = [str(rate)]
            for a in ADAPTERS:
                vals = [
                    m.get(metric)
                    for m in buckets[rate].get(a, [])
                    if m.get(metric) is not None
                ]
                if vals:
                    row.append(fmt(statistics.median(vals)))
                else:
                    row.append("—")
            print("| " + " | ".join(row) + " |")

    # Operating envelope — highest rate where absolute thresholds hold.
    print("\n### Operating envelope per adapter\n")
    print("Highest rate at which median frame p95 ≤ 16 ms AND median long_tasks_count == 0:\n")
    print("| Adapter | Highest passing rate | First failing rate | What broke |")
    print("|---------|---------------------|-------------------|------------|")
    for a in ADAPTERS:
        highest_pass = None
        first_fail = None
        broke_with = ""
        for rate in rates_seen:
            samples = buckets[rate].get(a, [])
            if not samples:
                continue
            fp_vals = [m.get("scroll_frame_p95_ms") for m in samples if m.get("scroll_frame_p95_ms") is not None]
            lt_vals = [m.get("long_tasks_count") for m in samples if m.get("long_tasks_count") is not None]
            if not fp_vals or not lt_vals:
                continue
            fp = statistics.median(fp_vals)
            lt = statistics.median(lt_vals)
            passes = fp <= 16 and lt == 0
            if passes:
                highest_pass = rate
            elif first_fail is None:
                first_fail = rate
                reasons = []
                if fp > 16:
                    reasons.append(f"fp95 = {fmt(fp)}ms")
                if lt > 0:
                    reasons.append(f"long_tasks = {fmt(lt)}")
                broke_with = "; ".join(reasons)
        print(
            f"| {a} | {fmt(highest_pass) if highest_pass else 'none'} | "
            f"{fmt(first_fail) if first_fail else '— (no break observed)'} | "
            f"{broke_with or '—'} |"
        )

    return 0


if __name__ == "__main__":
    sys.exit(main())
