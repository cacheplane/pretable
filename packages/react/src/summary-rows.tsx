import {
  createElement,
  useId,
  useLayoutEffect,
  useRef,
  type RefObject,
} from "react";
import type { PretableRow, PretableSummaryScope } from "@pretable/core";
import type { PlannedColumn } from "@pretable-internal/renderer-dom";
import type { PretableColumn } from "./types";
import type { PretableResolvedSummary, PretableSummaries } from "./summary";
import type { PretableSurfaceMessages } from "./pretable-surface";
import {
  formatSummaryValue,
  type ValueFormatterRegistry,
} from "./value-formatting";
import { formatCellValue } from "./rendering";
import { getPositionedCellStyle } from "./styles";
import { resolveColumnAlign } from "./column-align";

/** Read-only tables share the data viewport's geometry and scroll authority. */
export function SummaryRows<TRow extends PretableRow>({
  summaries,
  descriptors,
  columns,
  columnsById,
  columnCount,
  aggregateIds,
  viewportRef,
  viewportWidth,
  totalWidth,
  rowHeight,
  liveWidth,
  valueFormatters,
  messages,
  loadedOnly,
  onHeightChange,
}: {
  summaries: Partial<Record<PretableSummaryScope, PretableResolvedSummary>>;
  descriptors: PretableSummaries;
  columns: readonly PlannedColumn[];
  columnCount: number;
  columnsById: ReadonlyMap<string, PretableColumn<TRow>>;
  aggregateIds: ReadonlySet<string>;
  viewportRef: RefObject<HTMLDivElement | null>;
  viewportWidth: number;
  totalWidth: number;
  rowHeight: number;
  liveWidth: { columnId: string; width: number } | null;
  valueFormatters: ValueFormatterRegistry;
  messages: Required<PretableSurfaceMessages>;
  loadedOnly: boolean;
  onHeightChange: (height: number) => void;
}) {
  const id = useId();
  const root = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const source = viewportRef.current;
    const region = root.current;
    if (!source || !region) return;
    const sync = () => {
      for (const mirror of region.querySelectorAll<HTMLElement>(
        "[data-pretable-summary-scroll]",
      )) {
        mirror.scrollLeft = source.scrollLeft;
      }
    };
    sync();
    source.addEventListener("scroll", sync, { passive: true });
    return () => source.removeEventListener("scroll", sync);
  });
  useLayoutEffect(() => {
    const region = root.current;
    if (!region) return;
    const measure = () => {
      const height = region.getBoundingClientRect().height;
      if (height > 0) onHeightChange(height);
    };
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(region);
    return () => observer.disconnect();
  }, [onHeightChange]);
  return (
    <div
      ref={root}
      data-pretable-summaries=""
      style={{ flex: "0 0 auto", minWidth: 0, overflow: "hidden" }}
    >
      {(["filtered", "all"] as const).map((scope) => {
        const summary = summaries[scope];
        const descriptor = descriptors[scope];
        if (!summary || !descriptor) return null;
        const hasValues =
          summary.state === "ready" || summary.state === "stale";
        const loaded =
          summary.authority === "engine" &&
          (loadedOnly ||
            (descriptor.authority === "engine" &&
              descriptor.completeness === "partial"));
        const caption =
          descriptor.label ?? messages.summaryCaption({ scope, loaded });
        const context = [
          summary.authority === "server"
            ? messages.summaryServerLabel()
            : loaded && descriptor.label !== undefined
              ? messages.summaryLoadedLabel()
              : null,
          hasValues &&
          summary.completeness === "partial" &&
          summary.authority === "server"
            ? messages.summaryPartialLabel()
            : null,
          summary.state === "stale"
            ? messages.summaryStaleLabel({ label: summary.label })
            : null,
          !hasValues
            ? messages.summaryStateMessage({
                state: summary.state,
                message:
                  summary.state === "error" ? summary.message : undefined,
              })
            : null,
        ]
          .filter(Boolean)
          .join(" · ");
        return (
          <table
            key={scope}
            role="table"
            aria-colcount={columnCount}
            data-pretable-summary-scope={scope}
            data-pretable-summary-state={summary.state}
            style={{
              display: "block",
              borderSpacing: 0,
              width: viewportWidth || "100%",
              tableLayout: "fixed",
            }}
          >
            <caption
              style={{
                display: "block",
                textAlign: "start",
                minHeight: 28,
                boxSizing: "border-box",
                overflowWrap: "anywhere",
              }}
            >
              {caption}
              {context ? <span> · {context}</span> : null}
            </caption>
            <thead
              role="rowgroup"
              className="pt-sr-only"
              style={{
                position: "absolute",
                width: 1,
                height: 1,
                overflow: "hidden",
                clipPath: "inset(50%)",
              }}
            >
              <tr role="row">
                {columns.map((column) => (
                  <th
                    role="columnheader"
                    scope="col"
                    aria-colindex={column.index + 1}
                    id={`${id}-${scope}-${encodeURIComponent(column.id)}`}
                    key={column.id}
                  >
                    {columnsById.get(column.id)?.header ?? column.id}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody
              role="rowgroup"
              data-pretable-summary-scroll=""
              style={{ display: "block", overflow: "hidden", width: "100%" }}
            >
              <tr
                role="row"
                style={{
                  display: "flex",
                  position: "relative",
                  width: Math.max(totalWidth, viewportWidth),
                  height: rowHeight,
                }}
              >
                {columns.map((planned) => {
                  const column = columnsById.get(planned.id);
                  if (!column) return null;
                  const width =
                    liveWidth?.columnId === column.id
                      ? liveWidth.width
                      : planned.width;
                  return (
                    <td
                      key={column.id}
                      role="cell"
                      aria-colindex={planned.index + 1}
                      headers={`${id}-${scope}-${encodeURIComponent(column.id)}`}
                      data-pretable-summary-column={column.id}
                      data-pretable-column-align={resolveColumnAlign(column)}
                      data-pretable-pinned={planned.pinned}
                      style={{
                        ...getPositionedCellStyle(
                          planned,
                          width,
                          viewportWidth,
                        ),
                        flexShrink: 0,
                        textAlign: resolveColumnAlign(column),
                        overflow: "hidden",
                        whiteSpace: "nowrap",
                        textOverflow: "ellipsis",
                      }}
                    >
                      {(
                        summary.authority === "engine" && hasValues
                          ? Object.hasOwn(summary.values, column.id)
                          : aggregateIds.has(column.id)
                      )
                        ? hasValues
                          ? formatSummaryValue({
                              summary,
                              column,
                              valueFormatters,
                              fallback: formatCellValue,
                              unavailable: messages.summaryMissingValue(),
                            })
                          : messages.summaryStateMessage({
                              state: summary.state,
                              message:
                                summary.state === "error"
                                  ? summary.message
                                  : undefined,
                            })
                        : ""}
                    </td>
                  );
                })}
              </tr>
            </tbody>
          </table>
        );
      })}
    </div>
  );
}
