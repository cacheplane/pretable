import { createColumnHelper, type PretableRowModel } from "@pretable/core";
import { Pretable } from "@pretable/react";
import { createBatcher } from "@pretable/stream-adapter";
import { getDensityHeights } from "@pretable/ui";

interface Person {
  id: string;
  name: string;
}

const column = createColumnHelper<Person>();
const columns = [
  column.accessor("name", { header: "Name", type: "text" }),
] as const;
const rows = [{ id: "1", name: "Ada" }] as const satisfies readonly Person[];

declare const model: PretableRowModel<Person, string, typeof columns>;
const batcher = createBatcher(model);
batcher.dispose();

export const compactDensity = getDensityHeights();

export function ConsumerGrid() {
  return (
    <Pretable
      ariaLabel="People"
      columns={columns}
      getRowId={(row) => row.id}
      rows={rows}
    />
  );
}
