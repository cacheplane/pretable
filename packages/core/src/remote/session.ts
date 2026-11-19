import { canonicalRemoteRoute, prepareRemoteQuery } from "./query";
import {
  createResponseValidator,
  rangeAddress,
  snapshotWire,
  validateSession,
  validateRemoteResult,
} from "./validate-response";
import type {
  PretableRemoteError,
  PretableRemoteProvider,
  PretableRemoteQuery,
  PretableRemoteRange,
  PretableRemoteRangeRequest,
  PretableRemoteResult,
  PretableRemoteRoute,
  PretableRemoteSession,
  PretableRemoteSignal,
  PretableRemoteSummary,
} from "./types";

/** Internal composition boundary. The scheduler owns permits/retries; this
 * controller only owns acceptance. An invocation must settle after cancellation.
 * The callback checks ownership again when a queued permit eventually runs and
 * returns descriptor-validated envelopes so retry logic never reads raw provider
 * accessors. Success payload validation remains the acceptance layer's job. */
export interface RemoteInvocation {
  readonly kind: "open" | "read" | "summary";
  readonly generation: number;
  /** Sensitive internal address; never log or persist it. */
  readonly key: string;
  readonly signal: PretableRemoteSignal;
  /** Initial root read shares the scheduler focused tier. */
  readonly root?: boolean;
  /** Scheduler-only normalized failures after caller settlement; acceptance permits only scoped revocation. */
  readonly onLateResult?: (result: PretableRemoteResult<unknown>) => void;
}
export interface RemoteLifecycleReset {
  readonly generation: number;
  readonly reason:
    | "query"
    | "refresh"
    | "consistency"
    | "session-unauthorized"
    | "range-unauthorized"
    | "dispose";
  readonly range?: {
    readonly route: PretableRemoteRoute;
    readonly start: number;
    readonly end: number;
  };
}
interface Options {
  readonly rootRangeSize?: number;
  readonly now?: () => number;
  readonly onReset?: (event: RemoteLifecycleReset) => void;
  readonly invoke?: <T>(
    operation: RemoteInvocation,
    run: (signal?: PretableRemoteSignal) => Promise<PretableRemoteResult<T>>,
  ) => Promise<PretableRemoteResult<T>>;
}
export interface RemoteSessionView<TRow extends object> {
  readonly session: PretableRemoteSession;
  readonly ranges: readonly PretableRemoteRange<TRow>[];
  readonly summaries: readonly PretableRemoteSummary[];
}
export interface RemoteSessionSnapshot<TRow extends object> {
  readonly state: "idle" | "loading" | "ready" | "stale" | "error" | "disposed";
  readonly generation: number;
  readonly view?: RemoteSessionView<TRow>;
  readonly error?: PretableRemoteError;
  readonly errors?: Readonly<Record<string, PretableRemoteError>>;
}
/** Internal until the model facade composes scheduling, cache, and selection.
 * Snapshots are immutable. Consumers retaining snapshots own that extra memory.
 * No sync observation dispatches I/O. No automatic retries or expiry restarts. */
export function createRemoteSessionController<TRow extends object, TColumns>(
  provider: PretableRemoteProvider<TRow, TColumns>,
  options: Options = {},
) {
  type Validator = ReturnType<typeof createResponseValidator<TRow, TColumns>>;
  interface Context {
    generation: number;
    query: PretableRemoteQuery<TColumns>;
    queryKey: string;
    session?: PretableRemoteSession;
    validator?: Validator;
    owners: Map<string, AbortController>;
    requests: Map<string, PretableRemoteRangeRequest>;
    frozen: boolean;
    published: boolean;
    released: boolean;
  }
  let generation = 0,
    disposed = false;
  let current: Context | undefined;
  let lastQuery: PretableRemoteQuery<TColumns> | undefined;
  let visibleValidator: Validator | undefined;
  let snapshot: RemoteSessionSnapshot<TRow> = Object.freeze({
    state: "idle",
    generation,
  });
  const listeners = new Set<() => void>();
  const invoked = new WeakSet<AbortController>();
  const now = options.now ?? Date.now;
  const rootRangeSize =
    options.rootRangeSize ?? Math.min(50, provider.capabilities.maxRangeSize);
  if (
    !Number.isSafeInteger(rootRangeSize) ||
    rootRangeSize < 1 ||
    rootRangeSize > provider.capabilities.maxRangeSize
  )
    throw new Error("invalid root range size");
  function stage(next: RemoteSessionSnapshot<TRow>) {
    snapshot = Object.freeze(next);
    return snapshot;
  }
  function notify(expected: RemoteSessionSnapshot<TRow>) {
    for (const listener of [...listeners]) {
      if (snapshot !== expected) return;
      if (!listeners.has(listener)) continue;
      try {
        listener();
      } catch {
        /* Observers cannot interrupt acceptance. */
      }
    }
  }
  function publish(next: RemoteSessionSnapshot<TRow>) {
    notify(stage(next));
  }
  function active(c: Context) {
    return !disposed && current === c && c.generation === generation;
  }
  function reset(
    reason: RemoteLifecycleReset["reason"],
    range?: RemoteLifecycleReset["range"],
    resetGeneration = generation,
  ) {
    try {
      options.onReset?.(
        Object.freeze({
          generation: resetGeneration,
          reason,
          ...(range ? { range: snapshotWire(range) } : {}),
        }),
      );
    } catch {
      /* Composition observers cannot interrupt invalidation. */
    }
  }
  function release(session: PretableRemoteSession) {
    try {
      void provider.release(snapshotWire(session)).catch(() => {});
    } catch {
      /* Best effort, including synchronous adapter throws. */
    }
  }
  /** Detach ownership before running any adapter/abort callbacks. The returned
   * cleanup touches only captured resources, never mutable current state. */
  function stop(c: Context): () => void {
    c.frozen = true;
    const owners = [...c.owners.values()];
    c.owners.clear();
    c.requests.clear();
    const session = !c.released ? c.session : undefined;
    if (session) c.released = true;
    if (c.validator !== visibleValidator) c.validator?.dispose();
    return () => {
      for (const owner of owners) owner.abort();
      if (session) release(session);
    };
  }
  function purge() {
    visibleValidator?.dispose();
    visibleValidator = undefined;
  }
  function owns(c: Context, key: string, owner: AbortController) {
    return (
      !disposed &&
      current === c &&
      c.generation === generation &&
      !c.frozen &&
      c.owners.get(key) === owner
    );
  }
  function ownerFor(c: Context, key: string) {
    const previous = c.owners.get(key);
    const owner = new AbortController();
    c.owners.set(key, owner);
    previous?.abort();
    return owner;
  }
  function expired(c: Context): boolean {
    if (c.session?.expiresAt !== undefined && !c.frozen) {
      const time = now();
      if (!active(c)) return true;
      if (time >= c.session.expiresAt) handleError(c, { code: "expired" });
    }
    return !active(c) || c.frozen;
  }
  async function invoke<T>(
    c: Context,
    key: string,
    owner: AbortController,
    kind: RemoteInvocation["kind"],
    run: (signal: PretableRemoteSignal) => Promise<PretableRemoteResult<T>>,
    root = false,
  ): Promise<PretableRemoteResult<T>> {
    const guarded = async (
      signal: PretableRemoteSignal = owner.signal,
    ): Promise<PretableRemoteResult<T>> => {
      if (!owns(c, key, owner) || expired(c) || !owns(c, key, owner))
        return Promise.resolve<PretableRemoteResult<T>>({
          ok: false,
          error: { code: "cancelled" },
        });
      invoked.add(owner);
      let raw: unknown;
      try {
        raw = await run(signal);
      } catch {
        return { ok: false, error: { code: "transient" } };
      }
      const result = validateRemoteResult<T>(raw);
      // An abandoned open still owns a server resource, even when the scheduler
      // has already settled its caller or been disposed. Cleanup stays with the
      // physical provider call, and the acceptance path cannot release it twice.
      if (
        kind === "open" &&
        result.ok &&
        (signal.aborted || !owns(c, key, owner))
      ) {
        const abandoned = validateSession(
          result.value as PretableRemoteSession,
          c.queryKey,
        );
        if (abandoned.ok) release(abandoned.value);
        return { ok: false, error: { code: "cancelled" } };
      }
      return result;
    };
    let answer: unknown;
    try {
      answer = await (options.invoke
        ? options.invoke(
            {
              kind,
              root,
              generation: c.generation,
              key,
              signal: owner.signal,
              onLateResult: (result) => {
                acceptRevocation(c, owner, validateRemoteResult(result));
              },
            },
            guarded,
          )
        : guarded());
    } catch {
      return { ok: false, error: { code: "transient" } };
    }
    return validateRemoteResult<T>(answer);
  }
  /** Session-wide authorization has broader authority than a range attempt.
   * Only actually invoked requests can revoke their current context, even after
   * expiry or same-session retry supersession. A retiring context may revoke only
   * its exact still-owned stale view. Truly obsolete generations remain inert. */
  function acceptRevocation<T>(
    c: Context,
    owner: AbortController,
    response: PretableRemoteResult<T>,
  ): boolean {
    if (
      disposed ||
      !invoked.has(owner) ||
      response.ok ||
      response.error.code !== "unauthorized" ||
      response.error.scope !== "session"
    )
      return false;
    if (current === c && c.generation === generation) {
      handleError(c, response.error);
      return true;
    }
    const visible = snapshot.view?.session;
    if (
      c.validator &&
      c.validator === visibleValidator &&
      c.session &&
      visible &&
      c.session.sessionId === visible.sessionId &&
      c.session.queryKey === visible.queryKey &&
      c.session.resultToken === visible.resultToken
    ) {
      purge();
      const next = stage({
        state: current && !current.frozen ? "loading" : "error",
        generation,
        ...(current?.frozen && snapshot.error ? { error: snapshot.error } : {}),
      });
      reset("session-unauthorized", undefined, c.generation);
      notify(next);
      return true;
    }
    return false;
  }
  function viewWith(
    ranges: readonly PretableRemoteRange<TRow>[],
    summaries = snapshot.view?.summaries ?? [],
  ) {
    return Object.freeze({
      session: snapshot.view!.session,
      ranges: Object.freeze([...ranges]),
      summaries: Object.freeze([...summaries]),
    });
  }
  function evictRange(route: PretableRemoteRoute, start: number, end: number) {
    if (!snapshot.view) return;
    const key = rangeAddress(route, start, end);
    const ranges = snapshot.view.ranges.filter(
      (r) => rangeAddress(r.route, r.start, r.end) !== key,
    );
    visibleValidator?.releaseRange(route, start, end);
    const errors = { ...snapshot.errors };
    delete errors[key];
    publish({
      ...snapshot,
      view: viewWith(ranges),
      errors: Object.freeze(errors),
    });
  }
  function denyRange(
    c: Context,
    request: PretableRemoteRangeRequest,
  ): () => void {
    if (!snapshot.view || !c.published) return () => {};
    const cancelled: AbortController[] = [];
    const deniedRoute = canonicalRemoteRoute(request.route);
    const deniedGroups = snapshot.view.ranges
      .filter(
        (r) =>
          canonicalRemoteRoute(r.route) === deniedRoute &&
          r.start < request.end &&
          r.end > request.start,
      )
      .flatMap((r) =>
        r.entries.filter((n) => n.kind === "group").map((n) => n.route),
      );
    const removed = snapshot.view.ranges.filter(
      (r) =>
        (canonicalRemoteRoute(r.route) === deniedRoute &&
          r.start < request.end &&
          r.end > request.start) ||
        deniedGroups.some(
          (route) =>
            canonicalRemoteRoute(r.route.slice(0, route.length)) ===
            canonicalRemoteRoute(route),
        ),
    );
    // Revocation also invalidates still-pending overlapping attempts. Explicit
    // subsequent read calls may retry after the application recovers permission.
    for (const [key, pending] of c.requests) {
      const affected =
        (canonicalRemoteRoute(pending.route) === deniedRoute &&
          pending.start < request.end &&
          pending.end > request.start) ||
        deniedGroups.some(
          (route) =>
            canonicalRemoteRoute(pending.route.slice(0, route.length)) ===
            canonicalRemoteRoute(route),
        );
      if (affected) {
        const owner = c.owners.get(key);
        if (owner) cancelled.push(owner);
        c.owners.delete(key);
        c.requests.delete(key);
      }
    }
    for (const r of removed)
      visibleValidator?.releaseRange(r.route, r.start, r.end);
    for (const scope of ["filtered", "all"] as const) {
      const key = `summary:${scope}`;
      const owner = c.owners.get(key);
      if (owner) cancelled.push(owner);
      c.owners.delete(key);
    }
    visibleValidator?.releaseSummary("filtered");
    visibleValidator?.releaseSummary("all");
    stage({
      ...snapshot,
      view: viewWith(
        snapshot.view.ranges.filter((r) => !removed.includes(r)),
        [],
      ),
    });
    return () => {
      for (const owner of cancelled) owner.abort();
    };
  }
  function handleError(
    c: Context,
    error: PretableRemoteError,
    key?: string,
    request?: PretableRemoteRangeRequest,
  ) {
    if (!active(c)) return;
    let cleanup = () => {};
    let resetReason: RemoteLifecycleReset["reason"] | undefined;
    let resetRange: RemoteLifecycleReset["range"] | undefined;
    let next: RemoteSessionSnapshot<TRow>;
    if (
      error.code === "consistency" ||
      (error.code === "unauthorized" && error.scope === "session")
    ) {
      cleanup = stop(c);
      purge();
      resetReason =
        error.code === "consistency" ? "consistency" : "session-unauthorized";
      next = stage({ state: "error", generation: c.generation, error });
    } else if (error.code === "expired") {
      cleanup = stop(c);
      next = stage({
        state: snapshot.view ? "stale" : "error",
        generation: c.generation,
        ...(snapshot.view ? { view: snapshot.view } : {}),
        error,
      });
    } else {
      if (error.code === "unauthorized" && error.scope === "range" && request) {
        cleanup = denyRange(c, request);
        resetReason = "range-unauthorized";
        resetRange = request;
      }
      if (!c.published) cleanup = stop(c);
      next = stage({
        ...snapshot,
        state: snapshot.view ? (c.published ? "ready" : "stale") : "error",
        generation: c.generation,
        error,
        ...(key
          ? { errors: Object.freeze({ ...snapshot.errors, [key]: error }) }
          : {}),
      });
    }
    // The entire state transition is committed before invoking external code.
    // Cleanup may reenter, but it owns only detached old resources.
    cleanup();
    if (!active(c) || snapshot !== next) return;
    if (resetReason) reset(resetReason, resetRange, c.generation);
    if (!active(c)) return;
    notify(next);
  }
  async function readContext(
    c: Context,
    route: PretableRemoteRoute,
    start: number,
    end: number,
    root = false,
  ) {
    if (!active(c) || c.frozen || !c.session || !c.validator) return;
    let request: PretableRemoteRangeRequest;
    try {
      canonicalRemoteRoute(route);
      if (
        !Number.isSafeInteger(start) ||
        !Number.isSafeInteger(end) ||
        start < 0 ||
        end <= start ||
        end - start > provider.capabilities.maxRangeSize
      )
        throw 0;
      request = snapshotWire({ ...c.session, route, start, end });
    } catch {
      handleError(c, { code: "invalid-query" });
      return;
    }
    const checked = c.validator.validateRequest(request);
    if (!checked.ok) {
      handleError(c, { code: "invalid-query" });
      return;
    }
    const key = rangeAddress(route, start, end),
      owner = ownerFor(c, key);
    if (!owns(c, key, owner)) return;
    c.requests.set(key, request);
    const response = await invoke(
      c,
      key,
      owner,
      "read",
      (signal) => provider.read(request, signal),
      root,
    );
    if (
      acceptRevocation(c, owner, response) ||
      !owns(c, key, owner) ||
      expired(c) ||
      !owns(c, key, owner)
    )
      return;
    c.owners.delete(key);
    c.requests.delete(key);
    const answer = response.ok
      ? c.validator.acceptRange(request, response.value)
      : response;
    if (!answer.ok) {
      handleError(c, answer.error, key, request);
      return;
    }
    if (root) {
      if (visibleValidator !== c.validator) visibleValidator?.dispose();
      visibleValidator = c.validator;
      c.published = true;
      publish({
        state: "ready",
        generation,
        view: Object.freeze({
          session: c.session,
          ranges: Object.freeze([answer.value]),
          summaries: Object.freeze([]),
        }),
      });
    } else {
      const errors = { ...snapshot.errors };
      delete errors[key];
      publish({
        state: "ready",
        generation,
        view: viewWith([
          ...(snapshot.view?.ranges ?? []).filter(
            (r) => rangeAddress(r.route, r.start, r.end) !== key,
          ),
          answer.value,
        ]),
        errors: Object.freeze(errors),
      });
    }
  }
  async function start(
    queryInput: PretableRemoteQuery<TColumns>,
    reason: "query" | "refresh",
  ) {
    if (disposed) return;
    const startGeneration = ++generation;
    const stillStarting = () => !disposed && generation === startGeneration;
    const oldQuery = lastQuery;
    const previous = current;
    current = undefined;
    const cleanup = previous ? stop(previous) : () => {};
    cleanup();
    if (!stillStarting()) return;
    reset(reason, undefined, startGeneration);
    if (!stillStarting()) return;
    const prepared = prepareRemoteQuery(queryInput, provider.capabilities);
    if (!stillStarting()) return;
    if (!prepared.ok) {
      // An invalid scope transition must not leave protected stale rows visible.
      let sameScope = false;
      try {
        const auth = Object.getOwnPropertyDescriptor(queryInput, "authScope");
        const source = Object.getOwnPropertyDescriptor(queryInput, "source");
        sameScope =
          !!oldQuery &&
          !!auth &&
          "value" in auth &&
          !!source &&
          "value" in source &&
          auth.value === oldQuery.authScope &&
          source.value === oldQuery.source;
      } catch {
        /* Invalid/proxied input has no trusted scope identity. */
      }
      if (!stillStarting()) return;
      if (!sameScope) purge();
      publish({
        state: visibleValidator && snapshot.view ? "stale" : "error",
        generation,
        ...(visibleValidator && snapshot.view ? { view: snapshot.view } : {}),
        error: prepared.error,
      });
      return;
    }
    const query = snapshotWire(queryInput);
    if (!stillStarting()) return;
    lastQuery = query;
    if (
      oldQuery &&
      (oldQuery.authScope !== query.authScope ||
        oldQuery.source !== query.source)
    )
      purge();
    const c: Context = {
      generation: startGeneration,
      query,
      queryKey: prepared.queryKey,
      owners: new Map(),
      requests: new Map(),
      frozen: false,
      published: false,
      released: false,
    };
    current = c;
    publish({
      state: visibleValidator && snapshot.view ? "stale" : "loading",
      generation,
      ...(visibleValidator && snapshot.view ? { view: snapshot.view } : {}),
    });
    if (!active(c)) return;
    const owner = ownerFor(c, "open");
    const response = await invoke(c, "open", owner, "open", (signal) =>
      provider.open(query, prepared.queryKey, signal),
    );
    if (acceptRevocation(c, owner, response)) return;
    if (!owns(c, "open", owner)) {
      if (response.ok) {
        const abandoned = validateSession(response.value, prepared.queryKey);
        if (abandoned.ok) release(abandoned.value);
      }
      return;
    }
    c.owners.delete("open");
    const answer = response.ok
      ? validateSession(response.value, prepared.queryKey)
      : response;
    if (!answer.ok) {
      handleError(c, answer.error);
      return;
    }
    c.session = answer.value;
    c.validator = createResponseValidator(query, answer.value);
    if (expired(c)) return;
    await readContext(c, [], 0, rootRangeSize, true);
  }
  return {
    setQuery: (query: PretableRemoteQuery<TColumns>) => start(query, "query"),
    refresh: () =>
      lastQuery ? start(lastQuery, "refresh") : Promise.resolve(),
    read: (route: PretableRemoteRoute, start: number, end: number) =>
      current?.published
        ? readContext(current, route, start, end)
        : Promise.resolve(),
    async summary(scope: "filtered" | "all") {
      const c = current;
      if (!c?.published || !c.session || !c.validator || c.frozen) return;
      if (provider.capabilities.summaries[scope] !== "same-version") {
        if (expired(c)) return;
        handleError(c, { code: "unsupported-query" }, `summary:${scope}`);
        return;
      }
      const key = `summary:${scope}`,
        owner = ownerFor(c, key);
      if (!owns(c, key, owner)) return;
      const response = await invoke(c, key, owner, "summary", (signal) =>
        provider.summary(c.session!, scope, signal),
      );
      if (
        acceptRevocation(c, owner, response) ||
        !owns(c, key, owner) ||
        expired(c) ||
        !owns(c, key, owner)
      )
        return;
      c.owners.delete(key);
      const answer = response.ok
        ? c.validator.acceptSummary(scope, response.value)
        : response;
      if (!answer.ok) {
        handleError(c, answer.error, key);
        return;
      }
      const errors = { ...snapshot.errors };
      delete errors[key];
      publish({
        state: "ready",
        generation,
        view: viewWith(snapshot.view!.ranges, [
          ...snapshot.view!.summaries.filter((s) => s.scope !== scope),
          answer.value,
        ]),
        errors: Object.freeze(errors),
      });
    },
    getSnapshot() {
      return snapshot;
    },
    /** Explicit command for scheduler deadline ticks; never opens a replacement. */
    checkExpiry() {
      if (current && !current.frozen) expired(current);
    },
    subscribe(listener: () => void) {
      if (!disposed) listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    /** Task7 eviction must release published payload and its evidence together. */
    evictRange,
    evictSummary(scope: "filtered" | "all") {
      if (!snapshot.view) return;
      visibleValidator?.releaseSummary(scope);
      const errors = { ...snapshot.errors };
      delete errors[`summary:${scope}`];
      publish({
        ...snapshot,
        view: viewWith(
          snapshot.view.ranges,
          snapshot.view.summaries.filter((s) => s.scope !== scope),
        ),
        errors: Object.freeze(errors),
      });
    },
    retention() {
      const a = visibleValidator?.retention() ?? {
        nodes: 0,
        counts: 0,
        summaries: 0,
      };
      const b =
        current?.validator && current.validator !== visibleValidator
          ? current.validator.retention()
          : { nodes: 0, counts: 0, summaries: 0 };
      return {
        views: snapshot.view ? 1 : 0,
        nodes: a.nodes + b.nodes,
        counts: a.counts + b.counts,
        summaries: a.summaries + b.summaries,
      };
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      generation++;
      const previous = current;
      current = undefined;
      const cleanup = previous ? stop(previous) : () => {};
      lastQuery = undefined;
      purge();
      const next = stage({ state: "disposed", generation });
      cleanup();
      reset("dispose");
      notify(next);
      listeners.clear();
    },
  };
}
