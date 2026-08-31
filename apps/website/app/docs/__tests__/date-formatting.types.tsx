import {
  createColumnHelper,
  createLocalRowModel,
  isValidDateValue,
  type PretableDateFormatOptions,
} from "@pretable/core";
import { PretableSurface } from "@pretable/react";

/** Compile-time fixture for every fence on `grid/date-formatting.mdx`. */

interface Invoice {
  id: string;
  due: string | null;
}

interface Schedule {
  id: string;
  startsOn: string | null;
}

// docs-fence: grid/date-formatting.mdx#Validate at the boundary
export function calendarDateOrNull(value: unknown): string | null {
  if (value === null) return null;
  if (!isValidDateValue(value)) throw new Error("Expected YYYY-MM-DD or null");
  return value;
}

// docs-fence: grid/date-formatting.mdx#Rows mode
const column = createColumnHelper<Invoice>();
const columns = [
  column.accessor("due", {
    type: "date",
    header: "Due",
    aggregate: "max",
    dateFormat: { dateStyle: "medium" },
  }),
] as const;

export function InvoiceGrid({ rows }: { rows: readonly Invoice[] }) {
  return (
    <PretableSurface
      ariaLabel="Invoices"
      columns={columns}
      locale="en-US"
      rows={rows}
      viewportHeight={360}
    />
  );
}

// docs-fence: grid/date-formatting.mdx#Explicit-model presentation
const scheduleColumn = createColumnHelper<Schedule>();
const modelColumns = [
  scheduleColumn.accessor("startsOn", {
    type: "date",
    aggregate: "min",
    header: "Starts",
    dateFormat: { year: "numeric", month: "short", day: "2-digit" },
  }),
] as const;
const model = createLocalRowModel({
  rows: [{ id: "s1", startsOn: "2026-08-18" }],
  columns: modelColumns,
});

export const scheduleGrid = (
  <PretableSurface
    ariaLabel="Schedule"
    columns={modelColumns}
    locale="en-GB"
    model={model}
    viewportHeight={280}
  />
);

const dateOptions = {
  year: "numeric",
  month: "short",
  day: "2-digit",
} satisfies PretableDateFormatOptions;
void dateOptions;
