"use client";

import { useId, useState, type ComponentProps } from "react";
import { PretableButton, PretableSurface } from "@pretable/react";

import { columns } from "./columns";
import { invoices, type Invoice } from "./data";

export function InvoiceDatesGrid() {
  const localeId = useId();
  const [locale, setLocale] = useState("en-US");
  const [query, setQuery] = useState<
    NonNullable<ComponentProps<typeof PretableSurface<Invoice>>["query"]>
  >({
    filters: [],
    sort: [{ columnId: "due", direction: "asc" }],
    rowGroups: [],
  });

  return (
    <div style={{ fontSize: 13 }}>
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          alignItems: "center",
          gap: 12,
          marginBottom: 12,
        }}
      >
        <label htmlFor={localeId}>Date locale</label>
        <select
          id={localeId}
          value={locale}
          onChange={(event) => setLocale(event.target.value)}
        >
          <option value="en-US">English (US)</option>
          <option value="en-GB">English (UK)</option>
          <option value="de-DE">German</option>
        </select>
        <PretableButton
          onClick={() =>
            setQuery((current) => ({
              ...current,
              sort: [{ columnId: "due", direction: "asc" }],
            }))
          }
        >
          Earliest first
        </PretableButton>
        <PretableButton
          onClick={() =>
            setQuery((current) => ({
              ...current,
              sort: [{ columnId: "due", direction: "desc" }],
            }))
          }
        >
          Latest first
        </PretableButton>
      </div>
      <PretableSurface
        ariaLabel="Invoice due dates"
        columns={columns}
        rows={invoices}
        locale={locale}
        query={query}
        onQueryChange={setQuery}
        viewportHeight={280}
      />
      <p style={{ margin: "12px 0 0" }}>
        Locale changes the display, not the stored date. INV-104 has no due date
        and stays last in both date sort directions.
      </p>
    </div>
  );
}
