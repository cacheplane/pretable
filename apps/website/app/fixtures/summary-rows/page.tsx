"use client";

import {
  PretableSurface,
  type PretableColumn,
  type PretableSurfaceGrid,
  type PretableSummaries,
  type PretableServerSummaryResult,
} from "@pretable/react";
import { useRef, useState, type ComponentProps } from "react";

interface Delivery {
  id: string;
  hours: number;
  workstream: string;
  owner: string;
  status: string;
  budget: number;
}
const columns: PretableColumn<Delivery>[] = [
  {
    id: "hours",
    header: "Hours",
    type: "number",
    widthPx: 130,
    aggregate: "sum",
    pinned: "left",
    editable: true,
  },
  { id: "workstream", header: "Workstream", widthPx: 450 },
  { id: "owner", header: "Owner", widthPx: 170 },
  { id: "status", header: "Status", widthPx: 150 },
  {
    id: "budget",
    header: "Budget",
    type: "number",
    widthPx: 160,
    aggregate: "sum",
    pinned: "right",
    numberFormat: {
      style: "currency",
      currency: "USD",
      maximumFractionDigits: 0,
    },
  },
];
const initialRows: Delivery[] = Array.from({ length: 60 }, (_, i) => ({
  id: `delivery-${i}`,
  hours: 8 + i,
  workstream: ["Discovery", "Design", "Build", "Launch"][i % 4]!,
  owner: ["Ada", "Ben", "Cara"][i % 3]!,
  status: i % 2 ? "Planned" : "Active",
  budget: (i + 1) * 100,
}));
type Query = NonNullable<
  ComponentProps<typeof PretableSurface<Delivery>>["query"]
>;
export default function SummaryRowsFixturePage() {
  const grid = useRef<PretableSurfaceGrid<
    Delivery,
    string,
    typeof columns
  > | null>(null);
  const [rows, setRows] = useState(initialRows);
  const [enabled, setEnabled] = useState(true);
  const [mode, setMode] = useState("engine");
  const [answer, setAnswer] = useState("ready");
  const [partial, setPartial] = useState(false);
  const [definition, setDefinition] = useState("sum");
  const [request, setRequest] = useState("current");
  const [rtl, setRtl] = useState(false);
  const [narrow, setNarrow] = useState(false);
  const [panel, setPanel] = useState(false);
  const [tool, setTool] = useState(false);
  const [locale, setLocale] = useState("en-US");
  const [query, setQuery] = useState<Query>({
    filters: [],
    sort: [],
    rowGroups: [],
  });
  const [copied, setCopied] = useState("");
  const values = {
    requestKey: "current",
    aggregateDefinitionKey: "sum",
    completeness: partial ? ("partial" as const) : ("complete" as const),
    values: { hours: 9000, budget: 500000 },
  };
  const result: PretableServerSummaryResult =
    answer === "loading" || answer === "unavailable"
      ? { state: answer }
      : answer === "error"
        ? { state: "error", message: "Refresh failed" }
        : answer === "stale"
          ? { ...values, state: "stale", label: "Previous refresh" }
          : { ...values, state: "ready" };
  const summaries: PretableSummaries | undefined = enabled
    ? {
        filtered: { authority: "engine" },
        all:
          mode === "engine"
            ? { authority: "engine" }
            : {
                authority: "server",
                label: "Delivery plan",
                requestKey: request,
                aggregateDefinitionKey: definition,
                result,
              },
      }
    : undefined;
  return (
    <main style={{ padding: 16 }}>
      <h1>Delivery plan summaries</h1>
      <div
        style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBlock: 16 }}
      >
        <label>
          Authority{" "}
          <select
            value={mode}
            onChange={(event) => setMode(event.target.value)}
          >
            <option value="engine">Engine</option>
            <option value="server">Server all / engine matching</option>
          </select>
        </label>
        <label>
          Server state{" "}
          <select
            value={answer}
            onChange={(event) => setAnswer(event.target.value)}
          >
            {["ready", "loading", "stale", "error", "unavailable"].map(
              (state) => (
                <option key={state}>{state}</option>
              ),
            )}
          </select>
        </label>
        <button onClick={() => setPartial((v) => !v)}>Toggle partial</button>
        <button
          onClick={() =>
            setRequest((v) => (v === "current" ? "new" : "current"))
          }
        >
          Change request key
        </button>
        <button
          onClick={() => setDefinition((v) => (v === "sum" ? "avg" : "sum"))}
        >
          Change definition key
        </button>
        <button
          onClick={() =>
            setQuery((v) => ({
              ...v,
              filters: v.filters.length
                ? []
                : [{ columnId: "status", operator: "equals", value: "Active" }],
            }))
          }
        >
          Filter active
        </button>
        <button
          onClick={() =>
            setQuery((v) => ({
              ...v,
              rowGroups: v.rowGroups.length ? [] : [{ columnId: "workstream" }],
            }))
          }
        >
          Group workstreams
        </button>
        <button
          onClick={() =>
            setRows((v) =>
              v.map((row, i) =>
                i === 0 ? { ...row, hours: row.hours + 1 } : row,
              ),
            )
          }
        >
          Add hour
        </button>
        <button onClick={() => grid.current?.setColumnWidth("hours", 180)}>
          Resize hours
        </button>
        <button
          onClick={() =>
            grid.current?.setColumnOrder([
              "hours",
              "status",
              "owner",
              "workstream",
              "budget",
            ])
          }
        >
          Reorder columns
        </button>
        <button onClick={() => grid.current?.setColumnVisible("owner", false)}>
          Hide owner
        </button>
        <button onClick={() => grid.current?.setColumnPinned("hours", null)}>
          Unpin hours
        </button>
        <button onClick={() => setEnabled((v) => !v)}>Toggle summaries</button>
        <button onClick={() => setRtl((v) => !v)}>Toggle RTL</button>
        <button onClick={() => setNarrow((v) => !v)}>Toggle narrow</button>
        <button onClick={() => setPanel((v) => !v)}>Toggle group panel</button>
        <button onClick={() => setTool((v) => !v)}>Toggle tool panel</button>
        <button
          onClick={() => setLocale((v) => (v === "en-US" ? "de-DE" : "en-US"))}
        >
          Toggle locale
        </button>
      </div>
      <button data-before-grid="">Before grid</button>
      <section
        data-summary-fixture=""
        dir={rtl ? "rtl" : "ltr"}
        style={{ width: narrow ? 360 : 860, maxWidth: "100%", marginBlock: 12 }}
      >
        <PretableSurface
          ariaLabel="Delivery plan"
          columns={columns}
          rows={rows}
          query={query}
          onQueryChange={setQuery}
          summaries={summaries}
          viewportHeight={440}
          groupPanel={{ enabled: panel }}
          toolPanel={tool ? {} : false}
          processing={
            partial ? { filter: "external", sort: "external" } : undefined
          }
          resultMeta={
            partial
              ? {
                  total: { kind: "exact", count: 600 },
                  window: { start: 0, hasMore: true },
                }
              : undefined
          }
          locale={locale}
          onGridReady={(ready) => {
            grid.current = ready;
          }}
          copyToClipboard={(payload) => setCopied(payload.text)}
          onRowChange={({ rowId, columnId, value }) =>
            setRows((previous) =>
              previous.map((row) =>
                row.id === rowId ? { ...row, [columnId]: value } : row,
              ),
            )
          }
        />
      </section>
      <button data-after-grid="">After grid</button>
      <output aria-label="Copied data">{copied}</output>
    </main>
  );
}
