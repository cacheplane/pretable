import type { PersistentMap } from "./persistent-map";

export interface TransientMap<K extends string | number, V> {
  readonly size: number;
  get(key: K): V | undefined;
  has(key: K): boolean;
  set(key: K, value: V): this;
  delete(key: K): this;
  freeze(): PersistentMap<K, V>;
  entries(): IterableIterator<readonly [K, V]>;
}

export class TransientEditToken {
  #editable = true;

  assertEditable(): void {
    if (!this.#editable) {
      throw new Error("Cannot mutate a frozen transient map.");
    }
  }

  freeze(): void {
    this.#editable = false;
  }
}
