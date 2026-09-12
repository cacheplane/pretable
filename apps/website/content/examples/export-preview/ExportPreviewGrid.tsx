"use client";

import { useState } from "react";

import {
  defaultSaveFile,
  PretableButton,
  PretableSurface,
} from "@pretable/react";
import type { PretableCsvFile, PretableSurfaceGrid } from "@pretable/react";

import { columns } from "./columns";
import { orders, type Order } from "./data";

type OrdersGrid = PretableSurfaceGrid<Order, string, typeof columns>;

const exportColumns = [
  { id: "id", label: "Order" },
  { id: "customer", label: "Customer" },
  { id: "total", label: "Total" },
] as const;
const getRowId = (order: Order) => order.id;

export function ExportPreviewGrid() {
  const [grid, setGrid] = useState<OrdersGrid | null>(null);
  const [columnIds, setColumnIds] = useState<readonly string[]>(
    exportColumns.map((column) => column.id),
  );
  const [includeHeaders, setIncludeHeaders] = useState(true);
  const [delimiter, setDelimiter] = useState(",");
  const [preview, setPreview] = useState<PretableCsvFile | null>(null);

  return (
    <div style={{ minWidth: 0 }}>
      <p style={{ margin: "0 0 12px", fontSize: 13 }}>
        Preview captures the current grid output, including formatted totals.
        Regenerate it after changing export settings, then download that exact
        file.
      </p>
      <fieldset style={{ margin: "0 0 12px", minWidth: 0 }}>
        <legend>Export columns</legend>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 16 }}>
          {exportColumns.map((column) => (
            <label key={column.id}>
              <input
                type="checkbox"
                checked={columnIds.includes(column.id)}
                onChange={(event) => {
                  const checked = event.target.checked;
                  setColumnIds((current) =>
                    exportColumns
                      .filter((candidate) =>
                        candidate.id === column.id
                          ? checked
                          : current.includes(candidate.id),
                      )
                      .map((candidate) => candidate.id),
                  );
                  setPreview(null);
                }}
              />{" "}
              {column.label}
            </label>
          ))}
        </div>
      </fieldset>
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          alignItems: "center",
          gap: 12,
          marginBottom: 12,
        }}
      >
        <label>
          <input
            type="checkbox"
            checked={includeHeaders}
            onChange={(event) => {
              setIncludeHeaders(event.target.checked);
              setPreview(null);
            }}
          />{" "}
          Include headers
        </label>
        <label>
          Delimiter{" "}
          <select
            value={delimiter}
            onChange={(event) => {
              setDelimiter(event.target.value);
              setPreview(null);
            }}
          >
            <option value=",">Comma</option>
            <option value=";">Semicolon</option>
            <option value={"\t"}>Tab</option>
          </select>
        </label>
        <PretableButton
          disabled={!grid || columnIds.length === 0}
          onClick={() => {
            grid?.exportCsv({
              columnIds,
              includeHeaders,
              delimiter,
              bom: false,
            });
          }}
        >
          Preview CSV
        </PretableButton>
        <PretableButton
          disabled={!preview}
          onClick={() => {
            if (preview) defaultSaveFile(preview, { name: "orders-preview" });
          }}
        >
          Download CSV
        </PretableButton>
      </div>
      <PretableSurface<Order>
        ariaLabel="Orders for CSV preview"
        columns={columns}
        rows={orders}
        getRowId={getRowId}
        onGridReady={setGrid}
        saveFile={setPreview}
        toolPanel={false}
        viewportHeight={210}
      />
      <p role="status" style={{ margin: "12px 0", fontSize: 13 }}>
        {columnIds.length === 0
          ? "Select at least one column to preview."
          : preview
            ? `${preview.rowCount} rows · Preview ready. Download uses this exact file.`
            : `${orders.length} rows · Choose export options, then preview the CSV.`}
      </p>
      {preview && (
        <pre
          aria-label="CSV preview"
          style={{
            margin: 0,
            padding: 12,
            maxWidth: "100%",
            overflowX: "auto",
            fontSize: 12,
            border: "1px solid var(--pt-border-color, #888)",
            borderRadius: 4,
          }}
        >
          {preview.text}
        </pre>
      )}
    </div>
  );
}
