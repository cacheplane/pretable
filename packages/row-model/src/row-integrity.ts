import type { PretableRowId } from "./column-types";
import { PretableRowModelError } from "./errors";

const DEVELOPMENT = process.env.NODE_ENV !== "production";

interface DataFingerprintEntry {
  readonly kind: "data";
  readonly key: PropertyKey;
  readonly value: unknown;
  readonly enumerable: boolean;
  readonly configurable: boolean;
  readonly writable: boolean;
}

interface AccessorFingerprintEntry {
  readonly kind: "accessor";
  readonly key: PropertyKey;
  readonly get: (() => unknown) | undefined;
  readonly set: ((value: unknown) => void) | undefined;
  readonly enumerable: boolean;
  readonly configurable: boolean;
}

type FingerprintEntry = DataFingerprintEntry | AccessorFingerprintEntry;

export interface RowIntegrityFingerprint {
  readonly entries: readonly FingerprintEntry[];
}

export interface RowIntegrityRecord {
  readonly kind: "unchecked" | "frozen" | "fingerprinted";
  readonly fingerprint?: RowIntegrityFingerprint;
}

export interface PretableRowIntegrityDiagnostic<
  TRowId extends PretableRowId = PretableRowId,
> {
  readonly code: "same-reference-row-mutation";
  readonly rowId: TRowId;
  readonly message: string;
}

export type PretableRowIntegrityDiagnosticSink<TRowId extends PretableRowId> = (
  diagnostic: PretableRowIntegrityDiagnostic<TRowId>,
) => void;

export interface RowIntegrityInspection<TRowId extends PretableRowId> {
  readonly integrity: RowIntegrityRecord;
  readonly sameReferenceMutation: boolean;
  emitDiagnostic(
    sink: PretableRowIntegrityDiagnosticSink<TRowId> | undefined,
  ): void;
}

function failIntegrity(operation: "set-rows", cause: unknown): never {
  throw new PretableRowModelError(
    "derivation-failed",
    "A row could not be inspected safely before publication.",
    { operation, cause },
  );
}

function fingerprint(row: object): RowIntegrityFingerprint {
  try {
    const entries = Reflect.ownKeys(row).map((key): FingerprintEntry => {
      const descriptor = Object.getOwnPropertyDescriptor(row, key);
      if (descriptor === undefined) {
        throw new TypeError("An own row key disappeared during inspection.");
      }
      if ("value" in descriptor) {
        return Object.freeze({
          kind: "data" as const,
          key,
          value: descriptor.value,
          enumerable: descriptor.enumerable ?? false,
          configurable: descriptor.configurable ?? false,
          writable: descriptor.writable ?? false,
        });
      }
      return Object.freeze({
        kind: "accessor" as const,
        key,
        get: descriptor.get,
        set: descriptor.set,
        enumerable: descriptor.enumerable ?? false,
        configurable: descriptor.configurable ?? false,
      });
    });
    return Object.freeze({ entries: Object.freeze(entries) });
  } catch (cause) {
    return failIntegrity("set-rows", cause);
  }
}

function fingerprintsEqual(
  left: RowIntegrityFingerprint | undefined,
  right: RowIntegrityFingerprint,
): boolean {
  if (left === undefined || left.entries.length !== right.entries.length)
    return false;
  return left.entries.every((entry, index) => {
    const other = right.entries[index];
    if (
      other === undefined ||
      entry.kind !== other.kind ||
      entry.key !== other.key ||
      entry.enumerable !== other.enumerable ||
      entry.configurable !== other.configurable
    ) {
      return false;
    }
    if (entry.kind === "data" && other.kind === "data") {
      return (
        entry.writable === other.writable && Object.is(entry.value, other.value)
      );
    }
    return (
      entry.kind === "accessor" &&
      other.kind === "accessor" &&
      entry.get === other.get &&
      entry.set === other.set
    );
  });
}

/**
 * Applies the development-only immutable-row guard. Production takes a
 * constant-time path with no reflection, freezing, fingerprinting, or output.
 */
export function inspectRowIntegrity<TRowId extends PretableRowId>(
  row: object,
  rowId: TRowId,
  previous: RowIntegrityRecord | undefined,
  sameReference: boolean,
): RowIntegrityInspection<TRowId> {
  if (!DEVELOPMENT) {
    return {
      integrity: { kind: "unchecked" },
      sameReferenceMutation: false,
      emitDiagnostic: () => undefined,
    };
  }

  try {
    const prototype = Object.getPrototypeOf(row);
    const ordinary = prototype === Object.prototype || prototype === null;
    if (ordinary && Object.isExtensible(row)) {
      Object.freeze(row);
      return {
        integrity: { kind: "frozen" },
        sameReferenceMutation: false,
        emitDiagnostic: () => undefined,
      };
    }
  } catch (cause) {
    return failIntegrity("set-rows", cause);
  }

  const current = fingerprint(row);
  const sameReferenceMutation =
    sameReference &&
    previous?.kind === "fingerprinted" &&
    !fingerprintsEqual(previous.fingerprint, current);
  return {
    integrity: { kind: "fingerprinted", fingerprint: current },
    sameReferenceMutation,
    emitDiagnostic(sink) {
      if (!sameReferenceMutation || sink === undefined) return;
      try {
        sink({
          code: "same-reference-row-mutation",
          rowId,
          message:
            "A row object changed without changing identity; it was reevaluated.",
        });
      } catch {
        // Diagnostics must not add a failure mode to row ingestion.
      }
    },
  };
}
