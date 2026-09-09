"use client";

import { forwardRef, useState } from "react";
import {
  PretableSurface,
  PretableOverlayProvider,
  PretableTextInput,
  PretableTextarea,
  PretableIconButton,
  type PretableColumn,
  type PretableTextInputComponent,
  type PretableTextareaComponent,
  type PretableIconButtonComponent,
} from "@pretable/react";

interface Row {
  id: string;
  name: string;
  quantity: number | null;
  status: string | null;
  date: string | null;
  notes: string;
}
const INITIAL: Row[] = [
  {
    id: "a",
    name: "Alpha",
    quantity: 2,
    status: "b",
    date: "2026-08-18",
    notes: "First line",
  },
  {
    id: "b",
    name: "Beta",
    quantity: 3,
    status: "a",
    date: "2026-08-22",
    notes: "Second line",
  },
];
const COLUMNS: PretableColumn<Row>[] = [
  { id: "name", header: "Name", editable: true, widthPx: 140 },
  {
    id: "quantity",
    header: "Quantity",
    type: "number",
    editable: true,
    widthPx: 150,
    validate: (value) =>
      typeof value === "number" && value < 0 ? "Use a positive quantity" : true,
  },
  {
    id: "status",
    header: "Status",
    type: "enum",
    editable: true,
    widthPx: 160,
    formatEditValue: () => "Same",
    options: [
      { value: "a", label: "Same" },
      { value: "b", label: "Same" },
      { value: "Same", label: "Collision" },
    ],
  },
  { id: "date", header: "Date", type: "date", editable: true, widthPx: 160 },
  { id: "notes", header: "Notes", editable: true, wrap: true, widthPx: 230 },
];
const getRowId = (row: Row) => row.id;
const Input: PretableTextInputComponent = forwardRef(
  function Input(props, ref) {
    return <PretableTextInput {...props} ref={ref} data-fixture-input="" />;
  },
);
const Textarea: PretableTextareaComponent = forwardRef(
  function Textarea(props, ref) {
    return <PretableTextarea {...props} ref={ref} data-fixture-textarea="" />;
  },
);
const IconButton: PretableIconButtonComponent = forwardRef(
  function IconButton(props, ref) {
    return (
      <PretableIconButton {...props} ref={ref} data-fixture-icon-button="" />
    );
  },
);

export default function EditorKitFixture() {
  const [rows, setRows] = useState(INITIAL);
  const [saved, setSaved] = useState(0);
  const [dark, setDark] = useState(false);
  const [compact, setCompact] = useState(false);
  const [host, setHost] = useState<HTMLDivElement | null>(null);
  return (
    <main
      style={{ padding: 24 }}
      data-theme={dark ? "dark" : "light"}
      data-density={compact ? "compact" : "standard"}
    >
      <h1>Editor kit verification</h1>
      <button type="button" onClick={() => setCompact((value) => !value)}>
        Toggle compact
      </button>
      <button type="button" onClick={() => setDark((value) => !value)}>
        Toggle theme
      </button>{" "}
      <button type="button">Outside editor</button>
      <div style={{ marginTop: 16 }}>
        <PretableOverlayProvider container={host}>
          <PretableSurface
            key={String(compact)}
            ariaLabel="Editor kit"
            rows={rows}
            columns={COLUMNS}
            getRowId={getRowId}
            viewportHeight={260}
            components={{ TextInput: Input, Textarea, IconButton }}
            onRowChange={({ rowId, row }) => {
              setRows((previous) =>
                previous.map((item) => (item.id === rowId ? row : item)),
              );
              setSaved((count) => count + 1);
            }}
          />
        </PretableOverlayProvider>
      </div>
      <div ref={setHost} data-editor-overlay-host="" />
      <output data-saved-count="">{saved}</output>
      <pre data-saved-rows="">{JSON.stringify(rows, null, 2)}</pre>
    </main>
  );
}
