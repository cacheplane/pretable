import { AgGridAdapter } from "./ag-grid-adapter";
import { MuiAdapter } from "./mui-adapter";
import { PretableAdapter } from "./pretable-adapter";
import { TanstackAdapter } from "./tanstack-adapter";

/**
 * The adapters bench-app can mount, and the only list of them.
 *
 * It lives in its own module rather than in bench-app.tsx so that
 * comparator-wrapped-scale-rule.test.tsx can derive the comparator set from it
 * without importing bench-app's whole graph (bench-runtime, bench-runner,
 * @pretable/react, the interaction and update planners). That import is not
 * free: every extra vitest worker that pulls it in contends with the ones
 * already running, and this file exists to keep the fence cheaper than the trap
 * it guards.
 *
 * Deriving the comparator set from here is what makes the rule survive a NEW
 * adapter — one added below without the guard call reddens the fitness test
 * rather than quietly re-opening the trap.
 */
export const adapterRegistry = {
  "ag-grid": {
    heading: "AG Grid Community harness",
    description:
      "Community baseline using AG Grid v33 with themeQuartz, sortable + filter columns, and applyTransaction streaming updates.",
    render: AgGridAdapter,
  },
  pretable: {
    heading: "Pretable harness",
    description:
      "Deterministic `P0a` run surface for the public React adapter.",
    render: PretableAdapter,
  },
  tanstack: {
    heading: "TanStack Table harness",
    description:
      "Headless TanStack Table v9 + react-virtual baseline (real adapter ships in B2 Phase 2).",
    render: TanstackAdapter,
  },
  mui: {
    heading: "MUI X DataGrid Community harness",
    description:
      "Community baseline using MUI X DataGrid v7 (real adapter ships in B2 Phase 3).",
    render: MuiAdapter,
  },
} as const;

/** The adapter ids that are NOT pretable — the ones the rule applies to. */
export const comparatorAdapterIds = Object.keys(adapterRegistry).filter(
  (adapterId) => adapterId !== "pretable",
) as Exclude<keyof typeof adapterRegistry, "pretable">[];
