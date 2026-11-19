import type {
  PretableRemoteError,
  PretableRemoteNode,
  PretableRemoteQuery,
  PretableRemoteReadHandle,
  PretableRemoteSlot,
  PretableRemoteStatus,
} from "./types";
import type { PretableRemoteSummaryAnswer } from "./summaries";
/** Accounted estimates, not a process heap cap. @public */
export interface PretableRemoteModelLimits {
  payloadEntries: number;
  payloadBytes: number;
  ingressBytes: number;
  responseBytes: number;
  stores: number;
  topology: number;
  depth: number;
  expansions: number;
  selectedIds: number;
  cellRanges: number;
  measurements: number;
  metadataBytes: number;
}
/** Value-free local refusal; provider failures remain a separate protocol. @public */
export type PretableRemoteCapacity =
  | "invalid-cost"
  | "stale-plan"
  | "unknown-scope"
  | "payload-capacity"
  | "metadata-capacity"
  | "minimum-visible-too-large"
  | "intent-capacity";
/** @public */
export interface PretableRemoteModelOptions {
  readonly blockSize?: number;
  readonly limits?: Partial<PretableRemoteModelLimits>;
  /** Must be pure; reentrant/throwing hooks cause admission refusal. Transports must separately bound decoded bodies. */
  readonly estimateResponseBytes?: (value: unknown) => number;
  readonly now?: () => number;
}
/** Half-open display ranks. Demand is bounded to 64 aligned blocks. @public */
export interface PretableRemoteViewport {
  readonly start: number;
  readonly end: number;
}
/** Loaded visible addresses only; groups and leaves remain distinct. @public */
export interface PretableRemoteLoadedEntry<TRow extends object> {
  readonly index: number;
  readonly node: PretableRemoteNode<TRow>;
}
/** Immutable consumer-owned view. Retaining old snapshots retains their data outside model budgets. @public */
export interface PretableRemoteModelSnapshot<TRow extends object> {
  readonly status: PretableRemoteStatus;
  readonly generation: number;
  readonly rootCount: number;
  readonly displayCount: number;
  readonly residentCount: number;
  readonly residentLeafCount: number;
  readonly residentGroupCount: number;
  readonly capacity?: PretableRemoteCapacity;
  readonly error?: PretableRemoteError;
  readSlot(index: number): PretableRemoteSlot<TRow> | undefined;
  loadedEntries(): Iterable<PretableRemoteLoadedEntry<TRow>>;
  getSummary(scope: "filtered" | "all"): PretableRemoteSummaryAnswer;
}
/** Counts only: never query keys, protected routes or records. @public */
export interface PretableRemoteDiagnostics {
  readonly scopes: number;
  readonly payloadEntries: number;
  readonly payloadBytes: number;
  readonly metadataBytes: number;
  readonly ingressBytes: number;
  readonly topology: number;
  readonly expansions: number;
  readonly stores: number;
  readonly active: number;
  readonly queued: number;
  readonly subscribers: number;
  readonly evidenceNodes: number;
  readonly listeners: number;
  readonly capacity?: PretableRemoteCapacity;
}
/** Explicit lifecycle; synchronous observations never dispatch or check expiry. @public */
export interface PretableRemoteModel<
  TRow extends object,
  TColumns,
> extends PretableRemoteReadHandle<TRow> {
  getSnapshot(): PretableRemoteModelSnapshot<TRow>;
  readSlot(index: number): PretableRemoteSlot<TRow> | undefined;
  setQuery(query: PretableRemoteQuery<TColumns>): Promise<void>;
  refresh(): Promise<void>;
  demandViewport(viewport: PretableRemoteViewport): Promise<void>;
  setExpanded(id: string, expanded: boolean): boolean;
  requestSummary(scope: "filtered" | "all"): Promise<void>;
  retry(): Promise<void>;
  checkExpiry(): void;
  getDiagnostics(): PretableRemoteDiagnostics;
  dispose(): void;
}
