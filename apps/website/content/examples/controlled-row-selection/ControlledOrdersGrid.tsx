"use client";

import { useCallback, useEffect, useState } from "react";

import {
  describeRowSelection,
  PretableButton,
  PretableSurface,
} from "@pretable/react";
import type {
  PretableRowSelectionState,
  PretableSurfaceGrid,
} from "@pretable/react";

import { columns } from "./columns";
import { initialOrders, type Order } from "./data";

type OrdersGrid = PretableSurfaceGrid<Order, string, typeof columns>;
type CheckedOrders = PretableRowSelectionState<string>;

const getRowId = (order: Order) => order.id;

export function ControlledOrdersGrid() {
  const [orders, setOrders] = useState(initialOrders);
  const [grid, setGrid] = useState<OrdersGrid | null>(null);
  const [rowSelection, setRowSelection] = useState<CheckedOrders>({
    kind: "explicit",
    rowIds: [],
  });
  const [selectedCount, setSelectedCount] = useState(0);

  useEffect(() => {
    if (!grid) return;

    const readSelection = () => {
      // Unlike onRowSelectionChange, this also captures select-all and
      // exclusions. Keep that compact description in controlled state.
      const next = describeRowSelection(grid.getState().selection.rows);
      setRowSelection((previous) =>
        JSON.stringify(previous) === JSON.stringify(next) ? previous : next,
      );
      // All three local orders stay in this demo. Resolve their checked state
      // through the grid so select-all, exclusions, and spans work alike.
      setSelectedCount(
        initialOrders.filter((order) => grid.isRowSelected(order.id)).length,
      );
    };

    const unsubscribe = grid.subscribe(readSelection);
    readSelection();
    return unsubscribe;
  }, [grid]);

  const clearSelection = useCallback(() => {
    setRowSelection({ kind: "explicit", rowIds: [] });
  }, []);

  const selectAll = useCallback(() => {
    setRowSelection({ kind: "all" });
  }, []);

  const markShipped = useCallback(() => {
    if (!grid) return;
    const selectedIds = new Set(
      orders.filter((order) => grid.isRowSelected(order.id)).map(getRowId),
    );
    setOrders((current) =>
      current.map((order) =>
        selectedIds.has(order.id) ? { ...order, status: "Shipped" } : order,
      ),
    );
    clearSelection();
  }, [clearSelection, grid, orders]);

  return (
    <div>
      <p style={{ margin: "0 0 12px", fontSize: 13 }}>
        Check orders to act on them together. Mark shipped updates their status
        and clears the checkboxes. Selecting cells leaves the checked set alone.
      </p>
      <div
        style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 12 }}
      >
        <PretableButton disabled={selectedCount === 0} onClick={markShipped}>
          Mark shipped
        </PretableButton>
        <PretableButton disabled={selectedCount === 0} onClick={clearSelection}>
          Clear selection
        </PretableButton>
        <PretableButton onClick={selectAll}>Select all orders</PretableButton>
      </div>
      <PretableSurface
        ariaLabel="Order selection"
        columns={columns}
        rows={orders}
        getRowId={getRowId}
        rowSelectionColumn={{ enabled: true, headerCheckbox: true }}
        toolPanel={false}
        state={{ rowSelection }}
        onGridReady={setGrid}
        viewportHeight={240}
      />
      <p
        role="status"
        aria-label="Order selection"
        style={{ margin: "8px 0 0", fontSize: 13 }}
      >
        {selectedCount} of {orders.length} orders selected
      </p>
    </div>
  );
}
