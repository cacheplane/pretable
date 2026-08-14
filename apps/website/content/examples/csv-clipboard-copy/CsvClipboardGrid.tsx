"use client";

import { PretableSurface, serializeRanges } from "@pretable/react";

import { columns } from "./columns";
import { orders, type Order } from "./data";

// Code-only on purpose — see docs/grid/clipboard's intro. The interesting
// artifact of a copy lands on the OS clipboard, not the DOM, so a live demo
// would either fake navigator.clipboard.read() or prove nothing. This file
// is real and typechecked; it just isn't rendered anywhere.
export function CsvClipboardGrid() {
  return (
    <PretableSurface<Order>
      ariaLabel="Orders"
      columns={columns}
      getRowId={(row) => row.id}
      rows={orders}
      viewportHeight={320}
      onCopy={(args) => {
        // serializeRanges keeps the built-in range/column/header handling —
        // including filtering out the synthetic row-select column — so a
        // custom onCopy only has to post-process its output, not
        // reimplement it.
        const tsv = serializeRanges(args);
        if (!tsv) return null; // empty selection — cancel the copy

        // Returning only `text` also opts out of the HTML flavor (see
        // "Opting out" on docs/grid/clipboard): Excel and Sheets would
        // otherwise prefer text/html over this CSV rewrite.
        return { text: tsv.text.replace(/\t/g, ",") };
      }}
    />
  );
}
