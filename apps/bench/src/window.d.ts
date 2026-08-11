import type { BenchRunSummary } from "@pretable-internal/bench-runner";
import type { RowModelDiagnosticsController } from "./row-model-diagnostics";
import type { RowModelBenchSummary } from "./bench-types";

declare global {
  interface Window {
    __PRETABLE_BENCH_RESULT__?: BenchRunSummary & {
      rowModel?: RowModelBenchSummary;
    };
    __PRETABLE_BENCH_START__?: boolean;
    __PRETABLE_ROW_MODEL_BENCH__?: RowModelDiagnosticsController;
  }
}

export {};
