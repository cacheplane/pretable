import {
  readLayout,
  type ReadLayoutResult,
  type RowMetricsReader,
} from "@pretable-internal/layout-core";
import type {
  PretableRemoteModelSnapshot,
  PretableRemoteNode,
  PretableRemoteSlot,
} from "@pretable/core";
import {
  RemoteMetrics,
  type RemoteAnchor,
  type RemoteMetricsPreparation,
  type RemoteMeasurementBudget,
} from "./remote-metrics";
/** The accepted view can stay stale while command generation advances. */
function projectionIdentity(
  snapshot: PretableRemoteModelSnapshot<object> | undefined,
): string {
  if (!snapshot) return "empty";
  const status = snapshot.status;
  return status.state === "ready" || status.state === "stale"
    ? JSON.stringify([
        status.session.queryKey,
        status.session.sessionId,
        status.session.resultToken,
      ])
    : `pending:${snapshot.generation}`;
}
/** Type and node kind are part of identity; status addresses never become record IDs. */
export function remoteLayoutNodeKey(node: PretableRemoteNode<object>): string {
  return JSON.stringify([
    node.kind,
    typeof node.id,
    Object.is(node.id, -0) ? "-0" : node.id,
  ]);
}
export interface RemoteLayoutValue<TRow extends object> {
  readonly slot: PretableRemoteSlot<TRow>;
  readonly presentationKey: string;
  readonly businessKey?: string;
}
export interface RemoteLayoutViewport {
  readonly scrollTop: number;
  readonly viewportHeight: number;
  readonly overscan: number;
}
export interface RemoteLayoutState<
  TRow extends object,
> extends ReadLayoutResult<RemoteLayoutValue<TRow>> {
  readonly snapshot?: PretableRemoteModelSnapshot<TRow>;
  /** Missing identity falls back to clamped absolute offset, never a stale-rank neighbor. */
  readonly anchor: "identity" | "unavailable" | "none";
}
/** Separate cache-owned reservation for current/candidate derived rank maps. A
 * successful reservation stays charged until release; release must not throw.
 * Count/ID sizing happens cooperatively before allocating the candidate map.
 */
export interface RemoteProjectionBudget {
  reserve(bytes: number): (() => void) | undefined;
}
export interface RemoteLayoutOptions {
  readonly estimate: number;
  readonly measurementCap: number;
  readonly measurementBudget?: RemoteMeasurementBudget;
  readonly projectionBudget?: RemoteProjectionBudget;
}
/** No subscription, provider, clock, or demand side effects. The host advances
 * preparation outside render and commits only accepted immutable model views.
 * Old geometry remains published throughout preparation. Input wiring is separate.
 */
export class RemoteLayoutAdapter<TRow extends object> {
  private readonly metrics: RemoteMetrics;
  private ranks = new Map<string, number>();
  private snapshot: PretableRemoteModelSnapshot<TRow> | undefined;
  private viewport: RemoteLayoutViewport = {
    scrollTop: 0,
    viewportHeight: 600,
    overscan: 2,
  };
  private state: RemoteLayoutState<TRow>;
  private token = 0;
  private busy = false;
  private disposed = false;
  private releaseProjection: (() => void) | undefined;
  private cancelPending: (() => void) | undefined;
  constructor(private readonly options: RemoteLayoutOptions) {
    this.metrics = new RemoteMetrics(
      0,
      options.estimate,
      options.measurementCap,
      (id) => this.ranks.get(id),
      options.measurementBudget,
    );
    this.state = this.plan(undefined, this.metrics, "none");
  }
  private exclusive<T>(work: () => T): T {
    if (this.busy) throw new Error("Reentrant remote layout mutation");
    if (this.disposed) throw new Error("Disposed remote layout");
    this.busy = true;
    try {
      return work();
    } finally {
      this.busy = false;
    }
  }
  private plan(
    snapshot: PretableRemoteModelSnapshot<TRow> | undefined,
    metrics: RowMetricsReader,
    anchor: RemoteLayoutState<TRow>["anchor"],
    scrollTop = this.viewport.scrollTop,
  ): RemoteLayoutState<TRow> {
    const plan = readLayout({
      ...this.viewport,
      scrollTop,
      rowMetrics: metrics,
      readRange: (start, end) => {
        const values: RemoteLayoutValue<TRow>[] = [];
        for (let index = start; index < end; index++) {
          const slot = snapshot?.readSlot(index);
          if (!slot) throw new Error("Remote snapshot and geometry disagree");
          const businessKey =
            slot.kind === "loaded" ? remoteLayoutNodeKey(slot.node) : undefined;
          const identity =
            businessKey ??
            JSON.stringify([
              "status",
              slot.kind === "loaded"
                ? []
                : slot.route.map((segment) => [
                    segment.columnId,
                    typeof segment.key,
                    Object.is(segment.key, -0) ? "-0" : segment.key,
                  ]),
              slot.kind === "loaded" ? 0 : slot.ordinal,
            ]);
          values.push(
            Object.freeze({
              slot,
              presentationKey: `${projectionIdentity(snapshot)}:${identity}`,
              ...(businessKey === undefined ? {} : { businessKey }),
            }),
          );
        }
        return values;
      },
    });
    return Object.freeze({ ...plan, snapshot, anchor });
  }
  private capture(): RemoteAnchor | undefined {
    const index = this.metrics.getIndexForOffset(this.state.scrollTop);
    const slot = this.snapshot?.readSlot(index);
    return slot?.kind === "loaded"
      ? this.metrics.captureAnchor(
          remoteLayoutNodeKey(slot.node),
          this.state.scrollTop,
        )
      : undefined;
  }
  private publish(anchor?: RemoteAnchor): void {
    const restored = anchor ? this.metrics.restoreAnchor(anchor) : undefined;
    this.state = this.plan(
      this.snapshot,
      this.metrics,
      anchor ? (restored === undefined ? "unavailable" : "identity") : "none",
      restored ?? this.viewport.scrollTop,
    );
    this.viewport = { ...this.viewport, scrollTop: this.state.scrollTop };
  }
  getState(): RemoteLayoutState<TRow> {
    return this.state;
  }
  prepare(snapshot: PretableRemoteModelSnapshot<TRow>): {
    advance(maxUnits: number): boolean;
    commit(): boolean;
    cancel(): void;
  } {
    return this.exclusive(() => {
      this.cancelPending?.();
      const token = ++this.token;
      let iterator = snapshot.loadedEntries()[Symbol.iterator]();
      let phase: "size" | "map" | "metrics" = "size";
      let bytes = 128;
      const ranks = new Map<string, number>();
      let release: (() => void) | undefined;
      let pending: RemoteMetricsPreparation | undefined;
      let done = false,
        closed = false,
        refused = false;
      const cancel = () => {
        if (closed) return;
        closed = true;
        pending?.cancel();
        release?.();
        release = undefined;
        ranks.clear();
        if (this.cancelPending === cancel) this.cancelPending = undefined;
      };
      this.cancelPending = cancel;
      return {
        advance: (maxUnits) =>
          closed || this.disposed
            ? true
            : this.exclusive(() => {
                if (!Number.isSafeInteger(maxUnits) || maxUnits < 1)
                  throw new RangeError("Invalid preparation slice");
                if (closed || refused || token !== this.token) return true;
                try {
                  if (phase === "metrics") {
                    done = pending!.advance(maxUnits);
                    return done;
                  }
                  for (let unit = 0; unit < maxUnits; unit++) {
                    const entry = iterator.next();
                    if (entry.done) {
                      if (phase === "size") {
                        release = this.options.projectionBudget?.reserve(bytes);
                        if (this.options.projectionBudget && !release) {
                          refused = true;
                          return true;
                        }
                        iterator = snapshot.loadedEntries()[Symbol.iterator]();
                        phase = "map";
                      } else {
                        // Different accepted generations cannot inherit prior result measurements.
                        const rankOf = (id: string) => ranks.get(id);
                        pending = this.metrics.prepareSync(
                          snapshot.displayCount,
                          rankOf,
                          projectionIdentity(this.snapshot) ===
                            projectionIdentity(snapshot),
                        );
                        phase = "metrics";
                        return false;
                      }
                    } else {
                      const key = remoteLayoutNodeKey(entry.value.node);
                      if (phase === "size") bytes += 128 + key.length * 2;
                      else {
                        if (ranks.has(key))
                          throw new Error("Duplicate remote business identity");
                        ranks.set(key, entry.value.index);
                      }
                    }
                  }
                  return false;
                } catch (error) {
                  cancel();
                  throw error;
                }
              }),
        commit: () =>
          closed || this.disposed
            ? false
            : this.exclusive(() => {
                if (closed || refused || !done || token !== this.token) {
                  cancel();
                  return false;
                }
                try {
                  const anchor =
                    projectionIdentity(this.snapshot) ===
                    projectionIdentity(snapshot)
                      ? this.capture()
                      : undefined;
                  const metrics = pending!.read();
                  if (!metrics) {
                    cancel();
                    return false;
                  }
                  const rank = anchor ? ranks.get(anchor.id) : undefined;
                  const top =
                    rank === undefined
                      ? this.viewport.scrollTop
                      : metrics.getOffsetForIndex(rank) + anchor!.offset;
                  const state = this.plan(
                    snapshot,
                    metrics,
                    anchor
                      ? rank === undefined
                        ? "unavailable"
                        : "identity"
                      : "none",
                    top,
                  );
                  if (!pending!.commit()) {
                    cancel();
                    return false;
                  }
                  const oldRelease = this.releaseProjection;
                  this.releaseProjection = release;
                  release = undefined;
                  this.ranks = ranks;
                  this.snapshot = snapshot;
                  this.state = state;
                  this.viewport = {
                    ...this.viewport,
                    scrollTop: state.scrollTop,
                  };
                  closed = true;
                  this.cancelPending = undefined;
                  oldRelease?.();
                  return true;
                } catch (error) {
                  cancel();
                  throw error;
                }
              }),
        cancel: () => {
          if (!closed && !this.disposed) this.exclusive(cancel);
        },
      };
    });
  }
  setViewport(viewport: RemoteLayoutViewport): void {
    this.exclusive(() => {
      if (
        !Number.isFinite(viewport.scrollTop) ||
        !Number.isFinite(viewport.viewportHeight) ||
        viewport.viewportHeight < 0
      )
        throw new RangeError("Invalid viewport");
      this.viewport = { ...viewport };
      this.publish();
    });
  }
  reveal(index: number): void {
    this.exclusive(() => {
      if (
        !Number.isSafeInteger(index) ||
        index < 0 ||
        index >= this.metrics.rowCount
      )
        return;
      const top = this.metrics.getOffsetForIndex(index),
        height = this.metrics.getHeight(index);
      let scrollTop = this.state.scrollTop;
      if (top < scrollTop) scrollTop = top;
      else if (top + height > scrollTop + this.viewport.viewportHeight)
        scrollTop = top + height - this.viewport.viewportHeight;
      this.viewport = { ...this.viewport, scrollTop };
      this.publish();
    });
  }
  measureBatch(entries: readonly { id: string; height: number }[]): boolean {
    return this.exclusive(() => {
      for (const entry of entries)
        if (!this.ranks.has(entry.id))
          throw new Error("Cannot measure a status or unavailable row");
      const anchor = this.capture();
      if (!this.metrics.measureBatch(entries)) return false;
      this.cancelPending?.();
      this.cancelPending = undefined;
      this.token++;
      this.publish(anchor);
      return true;
    });
  }
  evictMeasurements(ids: readonly string[]): boolean {
    return this.exclusive(() => {
      const anchor = this.capture();
      if (!this.metrics.evictMeasurements(ids)) return false;
      this.cancelPending?.();
      this.cancelPending = undefined;
      this.token++;
      this.publish(anchor);
      return true;
    });
  }
  invalidateMeasurements(): boolean {
    return this.exclusive(() => {
      const anchor = this.capture();
      if (!this.metrics.invalidateMeasurements()) return false;
      this.cancelPending?.();
      this.cancelPending = undefined;
      this.token++;
      this.publish(anchor);
      return true;
    });
  }
  dispose(): void {
    if (this.disposed) return;
    this.exclusive(() => {
      this.cancelPending?.();
      this.cancelPending = undefined;
      if (!this.metrics.invalidateMeasurements())
        throw new Error("Measurement owner refused disposal release");
      this.releaseProjection?.();
      this.releaseProjection = undefined;
      this.ranks.clear();
      this.snapshot = undefined;
      this.state = this.plan(
        undefined,
        new RemoteMetrics(0, this.options.estimate, 0, () => undefined),
        "none",
        0,
      );
      this.disposed = true;
      this.token++;
    });
  }
}
