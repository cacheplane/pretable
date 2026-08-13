/**
 * The code fences on `grid/export.mdx`, transcribed so `tsc --noEmit` compiles
 * them. A documented snippet that does not compile is a documented lie, and
 * MDX is not typechecked.
 *
 * Each `// docs-fence:` marker binds everything up to the next marker to the
 * fence under that heading. The preamble above the first marker is prepended to
 * every region, which is what lets several snippets share one import.
 *
 * The page's `<PretableSurface>` fence is deliberately NOT here — see
 * `UNTRANSCRIBED_FENCES` in `docs-api-surface.test.ts` for why, and for where
 * that API is proven instead.
 */
import {
  defaultSaveFile,
  resolveDataScope,
  serializeCsv,
  type PretableColumn,
  type PretableRowModelSnapshot,
} from "@pretable/react";

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
