import type { BenchRunSummary } from "@pretable-internal/bench-runner";

declare global {
  interface Window {
    __PRETABLE_BENCH_RESULT__?: BenchRunSummary;
  }
}

export {};
