import type {
  PretableColumnAccessorKind,
  PretableColumnDefinition,
  PretableRowModel,
} from "@pretable/core";

export interface PrecompiledPosition {
  id: string;
  price: number;
}

export declare const precompiledDirectModel: PretableRowModel<
  PrecompiledPosition,
  string,
  readonly [
    PretableColumnDefinition<PrecompiledPosition, "price", number, "number"> &
      PretableColumnAccessorKind<"direct">,
  ]
>;
