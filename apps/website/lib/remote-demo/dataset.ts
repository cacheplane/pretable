/** Small, in-process backend fixture. Never use this as durable Next.js storage. */
export interface DemoOrder {
  id: string;
  tenant: string;
  region: string | null;
  customer: string | number | null;
  customerLabel: string;
  amount: number | null;
}

export const demoOrders: readonly DemoOrder[] = [
  {
    id: "w2",
    tenant: "demo",
    region: "West",
    customer: 1,
    customerLabel: "Acme",
    amount: 30,
  },
  {
    id: "w1",
    tenant: "demo",
    region: "West",
    customer: 1,
    customerLabel: "Acme",
    amount: 30,
  },
  {
    id: "w3",
    tenant: "demo",
    region: "West",
    customer: "1",
    customerLabel: "Acme",
    amount: 20,
  },
  {
    id: "w4",
    tenant: "demo",
    region: "West",
    customer: null,
    customerLabel: "(empty)",
    amount: 20,
  },
  {
    id: "e1",
    tenant: "demo",
    region: "East",
    customer: "a/b",
    customerLabel: "Acme",
    amount: 40,
  },
  {
    id: "e2",
    tenant: "demo",
    region: "East",
    customer: "a/b",
    customerLabel: "Acme",
    amount: null,
  },
  {
    id: "n1",
    tenant: "demo",
    region: null,
    customer: "other",
    customerLabel: "Other",
    amount: 30,
  },
  {
    id: "private",
    tenant: "other",
    region: "West",
    customer: 1,
    customerLabel: "Private",
    amount: 10000,
  },
];

export interface OrdersRead {
  readonly revision: number;
  readonly authorized: boolean;
  readonly rows: readonly Readonly<DemoOrder>[];
}

export function createOrdersDataset(
  initial: readonly DemoOrder[] = demoOrders,
  maxRows = 1000,
) {
  if (!Number.isSafeInteger(maxRows) || maxRows < 1)
    throw new Error("invalid fixture limit");
  function copy(rows: readonly DemoOrder[]) {
    if (rows.length > maxRows)
      throw new Error("fixture source capacity exceeded");
    const ids = new Set<string>();
    return Object.freeze(
      rows.map((row) => {
        if (
          ids.has(row.id) ||
          typeof row.id !== "string" ||
          !row.id ||
          typeof row.tenant !== "string" ||
          typeof row.customerLabel !== "string" ||
          (row.region !== null && typeof row.region !== "string") ||
          (row.customer !== null &&
            typeof row.customer !== "string" &&
            !(
              typeof row.customer === "number" && Number.isFinite(row.customer)
            )) ||
          (row.amount !== null &&
            !(typeof row.amount === "number" && Number.isFinite(row.amount)))
        )
          throw new Error("invalid fixture row");
        ids.add(row.id);
        return Object.freeze({ ...row });
      }),
    );
  }
  let rows = copy(initial);
  let revision = 1;
  let authorized = true;
  let before: (() => void) | undefined;
  let after: (() => void) | undefined;
  return {
    replace(next: readonly DemoOrder[]) {
      rows = copy(next);
      revision++;
    },
    revokeAuth() {
      authorized = false;
      revision++;
    },
    revokeSource() {
      authorized = false;
      revision++;
    },
    beforeNextRead(hook: () => void) {
      before = hook;
    },
    afterNextRead(hook: () => void) {
      after = hook;
    },
    /** No await/callback to external storage between fence and read. Immutable rows
     * and one synchronous operation model a database coherent read/transaction. */
    read<T>(operation: (view: OrdersRead) => T): T {
      const start = before;
      before = undefined;
      start?.();
      const result = operation({ revision, authorized, rows });
      const finish = after;
      after = undefined;
      finish?.();
      return result;
    },
  };
}
export type OrdersDataset = ReturnType<typeof createOrdersDataset>;
