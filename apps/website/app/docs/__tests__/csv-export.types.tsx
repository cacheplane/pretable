/**
 * The code fences on `grid/export.mdx`, transcribed so `tsc --noEmit` compiles
 * them. A documented snippet that does not compile is a documented lie, and
 * MDX is not typechecked.
 *
 * Each `// docs-fence:` marker binds everything up to the next marker to the
 * fence under that heading. The preamble above the first marker is prepended to
 * every region, which is what lets several snippets share one import.
 *
 * The page's `<PretableSurface>` fence used to be exempt from this file, on
 * the recorded grounds that its row type could not extend
 * `Record<string, unknown>` while the `serializeCsv` fences require exactly
 * that. Transcribing it proved the reason false: the constraint was never what
 * broke it — the snippet was missing its explicit type argument and referenced
 * an undeclared global. Both are fixed on the page, and the exemption is gone.
 */
import {
  defaultSaveFile,
  PretableSurface,
  resolveDataScope,
  serializeCsv,
  type PretableColumn,
  type PretableRowModelSnapshot,
  type PretableSurfaceGrid,
} from "@pretable/react";
import { useRef } from "react";

interface Position extends Record<string, unknown> {
  id: string;
  symbol: string;
}

declare const rowModelSnapshot: PretableRowModelSnapshot<
  Position,
  string,
  readonly { readonly id: string }[]
>;
declare const grid: { getColumns: () => readonly PretableColumn<Position>[] };
declare const dataHonesty: Parameters<typeof resolveDataScope>[0];
declare const processing: Parameters<typeof resolveDataScope>[1];

// docs-fence: grid/export.mdx#Getting a file
const file = serializeCsv({
  rowModelSnapshot,
  columns: grid.getColumns(),
  scope: resolveDataScope(dataHonesty, processing),
});

if (file) defaultSaveFile(file, { name: "positions" });

// docs-fence: grid/export.mdx#Formula escaping
serializeCsv({
  rowModelSnapshot,
  columns: grid.getColumns(),
  scope: "all",
  options: { escapeFormulas: (value) => value.startsWith("=") },
});

declare const columns: readonly PretableColumn<Position>[];

// docs-fence: grid/export.mdx#Getting a file (fence 2)
export function PositionGrid({ positions }: { positions: Position[] }) {
  const grid = useRef<PretableSurfaceGrid<
    Position,
    string,
    readonly PretableColumn<Position>[]
  > | null>(null);

  return (
    <>
      <button
        onClick={() => grid.current?.exportCsv({ onlySelected: true })}
        type="button"
      >
        Export selected
      </button>
      <PretableSurface<Position>
        ariaLabel="Positions"
        columns={columns}
        getRowId={(row) => row.id}
        onGridReady={(ready) => {
          grid.current = ready;
        }}
        rowSelectionColumn={{ enabled: true }}
        rows={positions}
        viewportHeight={520}
      />
    </>
  );
}
