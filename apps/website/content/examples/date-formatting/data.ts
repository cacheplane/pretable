export interface Invoice {
  id: string;
  due: string | null;
}

// Store calendar dates, not JavaScript Date objects or localized strings.
export const invoices: Invoice[] = [
  { id: "INV-101", due: "2026-09-18" },
  { id: "INV-102", due: "2026-01-15" },
  { id: "INV-103", due: "2026-12-02" },
  { id: "INV-104", due: null },
];
