"use client";

import { useLayoutEffect, useRef, useState } from "react";

import { PretableSurface } from "@pretable/react";

import "./deep-override.css";

import { columns } from "./columns";
import { tickets, type Ticket } from "./data";

const VIEWPORT_HEIGHT = 220;

export function DeepCssOverrideGrid() {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const [handleWidth, setHandleWidth] = useState<string | null>(null);

  useLayoutEffect(() => {
    const handle = wrapperRef.current?.querySelector<HTMLElement>(
      "[data-pretable-resize-handle]",
    );
    if (handle) {
      setHandleWidth(getComputedStyle(handle).width);
    }
  }, []);

  return (
    <div>
      <p style={{ margin: "0 0 8px", fontSize: 13 }}>
        Click a cell to select it. The header is uppercased and the resize
        handle (hover a column edge) is purple — both plain selectors, no{" "}
        <code>!important</code>.
      </p>
      <div className="cascade-demo" ref={wrapperRef}>
        <PretableSurface<Ticket>
          ariaLabel="Support tickets"
          columns={columns}
          getRowId={(row) => row.id}
          rows={tickets}
          viewportHeight={VIEWPORT_HEIGHT}
        />
      </div>
      <p style={{ margin: "8px 0 0", fontSize: 13 }}>
        The stylesheet above also asks the resize handle for{" "}
        <code>width: 8px</code>. Its computed width is{" "}
        <code>{handleWidth ?? "…"}</code> — the surface writes{" "}
        <code>width: 4px</code> inline, and inline styles beat every stylesheet
        rule.
      </p>
    </div>
  );
}
