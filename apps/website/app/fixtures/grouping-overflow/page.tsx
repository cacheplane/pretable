"use client";

import { PretableSurface, type PretableColumn } from "@pretable/react";
import { useMemo } from "react";

/**
 * Test fixture for the group panel's horizontal overflow, in
 * `apps/website/e2e/grouping.spec.ts`.
 *
 * A sibling of `/fixtures/grouping` rather than a second grid on it: every
 * locator in that file's assertions is page-wide (`panel(page)`,
 * `headerCell(page, id)`, `chipIds(page)`), so a second grid on the same route
 * would turn each of them into a strict-mode violation. A route is cheaper than
 * re-scoping the suite, and it lets this page pin the one thing the assertions
 * need and the other page must NOT have: a panel too narrow for its chips.
 *
 * Two numbers are load-bearing, so change them together or not at all:
 *
 * - **The 560px wrapper.** The panel inherits it, and chips cap at `14em`
 *   (~180px at the header font size), so eight of them are roughly three times
 *   the strip's width. Widen this and the overflow — hence every assertion
 *   here — quietly disappears.
 * - **Eight grouping levels, with headers long enough to hit that cap.** Short
 *   labels would let the chips shrink to fit and, again, not overflow.
 *
 * The grouped values are deliberately near-constant past the second level: the
 * panel is what is under test, and 2^8 group branches would cost render time
 * without adding a chip.
 */

interface OverflowRow {
  [key: string]: unknown;
  id: string;
  alpha: string;
  bravo: string;
  charlie: string;
  delta: string;
  echo: string;
  foxtrot: string;
  golf: string;
  hotel: string;
  name: string;
  qty: number;
}

const GROUPED_IDS = [
  "alpha",
  "bravo",
  "charlie",
  "delta",
  "echo",
  "foxtrot",
  "golf",
  "hotel",
] as const;

/** Long enough that a chip hits its `max-width` and its label ellipses. */
const HEADERS: Record<(typeof GROUPED_IDS)[number], string> = {
  alpha: "Alpha Classification Level",
  bravo: "Bravo Classification Level",
  charlie: "Charlie Classification Level",
  delta: "Delta Classification Level",
  echo: "Echo Classification Level",
  foxtrot: "Foxtrot Classification Level",
  golf: "Golf Classification Level",
  hotel: "Hotel Classification Level",
};

function makeRows(): OverflowRow[] {
  const rows: OverflowRow[] = [];
  for (let a = 1; a <= 3; a += 1) {
    for (let b = 1; b <= 2; b += 1) {
      for (let r = 1; r <= 4; r += 1) {
        rows.push({
          id: `a${a}-b${b}-r${r}`,
          alpha: `Alpha ${a}`,
          bravo: `Bravo ${b}`,
          charlie: "Charlie",
          delta: "Delta",
          echo: "Echo",
          foxtrot: "Foxtrot",
          golf: "Golf",
          hotel: "Hotel",
          name: `Row ${a}-${b}-${r}`,
          qty: a * 100 + b * 10 + r,
        });
      }
    }
  }
  return rows;
}

const COLUMNS: PretableColumn<OverflowRow>[] = [
  ...GROUPED_IDS.map((id) => ({
    id,
    header: HEADERS[id],
    rowGroup: true,
  })),
  { id: "name", header: "Name", widthPx: 180 },
  { id: "qty", header: "Qty", type: "number" as const, widthPx: 100 },
];

export default function GroupingOverflowFixturePage() {
  const rows = useMemo(() => makeRows(), []);
  const columns = useMemo(() => COLUMNS, []);
  return (
    <main style={{ padding: 24 }}>
      <h1 style={{ marginBottom: 12 }}>Grouping panel overflow fixture</h1>
      <div style={{ width: 560 }}>
        <PretableSurface<OverflowRow>
          ariaLabel="Deeply grouped rows"
          columns={columns}
          getRowId={(row) => row.id}
          groupPanel={{ enabled: true }}
          rows={rows}
          viewportHeight={300}
        />
      </div>
    </main>
  );
}
