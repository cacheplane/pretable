import {
  createRemoteSessionController,
  type RemoteInvocation,
} from "./session";
import { createRemoteScheduler } from "./scheduler";
import { ModelRetention, wireBytes } from "./model-retention";
import { createModelView, type ModelBlock } from "./model-view";
import {
  canonicalRemoteRoute,
  prepareRemoteQuery,
  remoteGroupId,
} from "./query";
import { rangeAddress, snapshotWire } from "./validate-response";
import type { CacheRecord } from "./cache";
import type {
  PretableRemoteModel,
  PretableRemoteModelOptions,
  PretableRemoteViewport,
} from "./model-types";
import type {
  PretableRemoteProvider,
  PretableRemoteQuery,
  PretableRemoteResult,
} from "./types";

/** Creates an explicitly owned headless server read model. Construction and all
 * synchronous reads are inert; call setQuery and declare viewport demand.
 * Provider transports must enforce decoded response limits independently.
 * @public */
export function createRemoteModel<TRow extends object, TColumns>(
  provider: PretableRemoteProvider<TRow, TColumns>,
  options: PretableRemoteModelOptions = {},
): PretableRemoteModel<TRow, TColumns> {
  const blockSize =
    options.blockSize ?? Math.min(100, provider.capabilities.maxRangeSize);
  if (
    !Number.isSafeInteger(blockSize) ||
    blockSize < 1 ||
    blockSize > Math.min(1000, provider.capabilities.maxRangeSize)
  )
    throw new RangeError("Invalid remote block size");
  const retention = new ModelRetention<TRow>(options);
  const listeners = new Set<() => void>();
  const listenerKeys = new Map<() => void, string>();
  let listenerSequence = 0;
  const pending = new Map<string, Promise<void>>();
  const summaryPending = new Map<string, Promise<void>>();
  const refusedSummaries = new Set<"filtered" | "all">();
  const requests = new Map<string, { physical: number; callerDone: boolean }>();
  let queryRejected = false;
  let disposed = false,
    command = 0;
  let query: PretableRemoteQuery<TColumns> | undefined,
    viewQuery: PretableRemoteQuery<TColumns> | undefined,
    queryKey: string | undefined;
  let viewport: PretableRemoteViewport | undefined;
  // Fixed-size refusal identity, never the unadmitted route/key candidate map.
  let refusedViewport: PretableRemoteViewport | undefined;
  let wanted = new Map<string, ModelBlock>();
  const requestKey = (op: RemoteInvocation) =>
    JSON.stringify(["request", op.generation, op.kind, op.key, op.ownership]);
  function finishRequest(key: string) {
    const request = requests.get(key);
    if (!request || request.physical || !request.callerDone) return;
    requests.delete(key);
    retention.dropGlobal(key);
    scheduler.wake();
  }
  const scheduler = createRemoteScheduler({
    acquire(op) {
      const lease = retention.cache.reserveIngress(
        retention.cache.limits.responseBytes,
      );
      if (!lease) return;
      const key = requestKey(op),
        request = requests.get(key);
      if (request) request.physical++;
      return () => {
        retention.cache.releaseIngress(lease);
        if (request) request.physical--;
        finishRequest(key);
      };
    },
  });
  function apply(plan: ReturnType<ModelRetention<TRow>["prepare"]>) {
    if (!plan || !plan.commit()) return false;
    for (const r of plan.evictions)
      sessionController.evictRange(r.route, r.start, r.end, true);
    sessionController.retainTopology([...retention.groups.values()]);
    return true;
  }
  const sessionController = createRemoteSessionController(provider, {
    rootRangeSize: blockSize,
    now: options.now,
    onReset(event) {
      if (event.reason === "range-unauthorized" && event.range) {
        refusedSummaries.clear();
        const range = event.range;
        const denied = [...retention.groups.values()].filter(
          (group) =>
            canonicalRemoteRoute(group.route.slice(0, -1)) ===
              canonicalRemoteRoute(range.route) &&
            group.ordinal >= range.start &&
            group.ordinal < range.end,
        );
        const affected = [...retention.groups.values()].filter((group) =>
          denied.some(
            (parent) =>
              canonicalRemoteRoute(
                group.route.slice(0, parent.route.length),
              ) === canonicalRemoteRoute(parent.route),
          ),
        );
        const expanded = new Set(retention.expanded);
        const drops: { scope: number; key: string }[] = [];
        for (const group of affected) {
          expanded.delete(group.id);
          drops.push({ scope: -1, key: `expanded:${group.id}` });
        }
        const state = sessionController.getSnapshot();
        const retained = new Set(
          state.view?.ranges.map((r) =>
            rangeAddress(r.route, r.start, r.end),
          ) ?? [],
        );
        for (const r of retention.ranges())
          if (!retained.has(rangeAddress(r.route, r.start, r.end)))
            drops.push({
              scope: retention.visible,
              key: rangeAddress(r.route, r.start, r.end),
            });
        for (const scope of ["filtered", "all"])
          drops.push({ scope: retention.visible, key: `summary:${scope}` });
        apply(retention.prepare({ drops, expanded }));
      }
      if (
        event.reason === "session-unauthorized" ||
        event.reason === "consistency"
      ) {
        retention.close(event.generation);
        retention.clearIntent();
        pending.clear();
        summaryPending.clear();
        refusedSummaries.clear();
        wanted.clear();
      }
    },
    prepareQuery(generation) {
      if (!query || !queryKey || !retention.begin(generation)) {
        query = undefined;
        queryKey = undefined;
        return false;
      }
      const plan = retention.prepare({
        additions: [
          {
            scope: generation,
            key: "query",
            kind: "external",
            value: query,
            metadataBytes: wireBytes(query) * 2 + 4 * queryKey.length,
          },
          {
            scope: -1,
            key: "configuration",
            kind: "external",
            value: query,
            metadataBytes: wireBytes(query) * 2 + 4 * queryKey.length,
          },
        ],
      });
      const admitted = apply(plan);
      if (!admitted) {
        query = undefined;
        queryKey = undefined;
      }
      return admitted;
    },
    prepareSession(session, generation) {
      const epoch = retention.cache.snapshot().epoch;
      const record: CacheRecord = {
        scope: generation,
        key: "session",
        kind: "external",
        value: session,
        metadataBytes: wireBytes(session) * 2,
      };
      return apply(
        retention.prepare({ additions: [record], expectedEpoch: epoch }),
      );
    },
    prepareAdmission(input) {
      const epoch = retention.cache.snapshot().epoch;
      const expectedCommand = command;
      const refuseSummary = () => {
        if (!disposed && command === expectedCommand && "scope" in input.value)
          refusedSummaries.add(input.value.scope);
      };
      let record: CacheRecord;
      try {
        record = retention.responseRecord(
          input.generation,
          input.value,
          input.root ||
            (!("scope" in input.value) &&
              wanted.has(
                rangeAddress(
                  input.value.route,
                  input.value.start,
                  input.value.end,
                ),
              )),
        );
      } catch {
        if (expectedCommand === command && !disposed)
          retention.capacity = "invalid-cost";
        refuseSummary();
        return;
      }
      if (disposed || command !== expectedCommand) return;
      const plan = retention.prepare({
        additions: [record],
        root: input.root,
        expectedEpoch: epoch,
      });
      if (!plan) {
        refuseSummary();
        return;
      }
      // Stage topology before committing any owner. SparseIndex validates exact
      // safe extents and ancestry; observers never see a mutable index instance.
      try {
        retention.index(input.session.rootCount, plan.groups);
      } catch {
        retention.capacity = "intent-capacity";
        plan.discard();
        refuseSummary();
        return;
      }
      return {
        evictions: plan.evictions,
        commit: () => {
          if (disposed || command !== expectedCommand || !plan.commit())
            return false;
          if (input.root) viewQuery = query;
          if ("scope" in input.value)
            refusedSummaries.delete(input.value.scope);
          return true;
        },
      };
    },
    async invoke<T>(
      operation: RemoteInvocation,
      run: (
        signal?: import("./types").PretableRemoteSignal,
      ) => Promise<PretableRemoteResult<T>>,
    ): Promise<PretableRemoteResult<T>> {
      if (
        retention.cache.limits.ingressBytes <
        retention.cache.limits.responseBytes
      ) {
        retention.capacity = "minimum-visible-too-large";
        return { ok: false, error: { code: "cancelled" } };
      }
      const key = requestKey(operation);
      const record: CacheRecord = {
        scope: -1,
        key,
        kind: "external",
        value: undefined,
        metadataBytes:
          256 +
          4 * operation.key.length +
          (operation.retainedMetadataBytes ?? 0),
      };
      const plan = retention.prepare({ additions: [record] });
      if (!apply(plan)) return { ok: false, error: { code: "cancelled" } };
      const request = { physical: 0, callerDone: false };
      requests.set(key, request);
      try {
        if (plan?.evictions.length) publish();
        if (disposed || operation.signal.aborted)
          return { ok: false, error: { code: "cancelled" } };
        return await scheduler.schedule(
          {
            ...operation,
            scope:
              operation.kind === "read" && !operation.root
                ? "viewport"
                : undefined,
          },
          run,
        );
      } finally {
        request.callerDone = true;
        finishRequest(key);
      }
    },
  });
  let snapshot = createModelView(
    sessionController.getSnapshot(),
    retention,
    viewQuery,
    provider.capabilities,
    new Set(),
    new Set(),
    blockSize,
  );
  function publish() {
    if (disposed) return;
    sessionController.retainTopology([...retention.groups.values()]);
    snapshot = createModelView(
      sessionController.getSnapshot(),
      retention,
      viewQuery,
      provider.capabilities,
      new Set(pending.keys()),
      new Set(summaryPending.keys()),
      blockSize,
    );
    const expected = snapshot;
    for (const listener of [...listeners]) {
      if (disposed || snapshot !== expected) break;
      if (listeners.has(listener)) {
        try {
          listener();
        } catch {
          /* Observer isolation. */
        }
      }
    }
  }
  sessionController.subscribe(() => {
    const state = sessionController.getSnapshot();
    // Revocation can remove an entire branch atomically inside the session.
    if (state.view) {
      const retained = new Set(
        state.view.ranges.map((r) => rangeAddress(r.route, r.start, r.end)),
      );
      const drops = retention
        .ranges()
        .filter((r) => !retained.has(rangeAddress(r.route, r.start, r.end)))
        .map((r) => ({
          scope: retention.visible,
          key: rangeAddress(r.route, r.start, r.end),
        }));
      if (drops.length) apply(retention.prepare({ drops }));
    } else if (state.state === "error") retention.clearBodies();
    publish();
  });
  async function setQuery(input: PretableRemoteQuery<TColumns>, force = false) {
    if (disposed) return;
    const expected = ++command;
    const prepared = prepareRemoteQuery(input, provider.capabilities);
    if (disposed || command !== expected) return;
    if (!prepared.ok) {
      queryRejected = true;
      let sameScope = false;
      try {
        const source = Object.getOwnPropertyDescriptor(input, "source"),
          auth = Object.getOwnPropertyDescriptor(input, "authScope");
        sameScope =
          !!query &&
          !!source &&
          "value" in source &&
          !!auth &&
          "value" in auth &&
          source.value === query.source &&
          auth.value === query.authScope;
      } catch {
        /* Invalid input cannot establish an authorized scope. */
      }
      if (!sameScope) {
        retention.clearBodies();
        retention.clearIntent();
        viewQuery = undefined;
        query = undefined;
        queryKey = undefined;
        retention.dropGlobal("configuration");
      }
      pending.clear();
      summaryPending.clear();
      refusedSummaries.clear();
      wanted.clear();
      viewport = undefined;
      refusedViewport = undefined;
      retention.dropGlobal("viewport");
      await sessionController.setQuery(input);
      return;
    }
    if (!force && !queryRejected && prepared.queryKey === queryKey) return;
    queryRejected = false;
    const next = snapshotWire(input);
    if (disposed || command !== expected) return;
    const scopeChanged =
      !query ||
      query.source !== next.source ||
      query.authScope !== next.authScope;
    if (scopeChanged) {
      retention.clearBodies();
      retention.clearIntent();
      viewQuery = undefined;
    }
    retention.dropGlobal("viewport");
    retention.dropGlobal("configuration");
    query = next;
    queryKey = prepared.queryKey;
    pending.clear();
    summaryPending.clear();
    refusedSummaries.clear();
    wanted.clear();
    viewport = undefined;
    refusedViewport = undefined;
    retention.capacity = undefined;
    await sessionController.setQuery(next);
  }
  async function demandViewport(next: PretableRemoteViewport, force = false) {
    if (disposed) return;
    if (
      !Number.isSafeInteger(next.start) ||
      !Number.isSafeInteger(next.end) ||
      next.start < 0 ||
      next.end < next.start
    )
      throw new RangeError("Invalid viewport");
    const expectedCommand = command;
    if (
      !force &&
      refusedViewport?.start === next.start &&
      refusedViewport.end === next.end
    )
      return;
    const changed =
      force ||
      !viewport ||
      viewport.start !== next.start ||
      viewport.end !== next.end;
    if (!changed) {
      await Promise.all(pending.values());
      return;
    }
    const requestedViewport = Object.freeze({
      start: next.start,
      end: next.end,
    });
    const refuseViewport = () => {
      refusedViewport = requestedViewport;
      publish();
    };
    if (next.end - next.start > blockSize * 64) {
      retention.capacity = "minimum-visible-too-large";
      refuseViewport();
      return;
    }
    if (retention.capacity && !snapshot.displayCount) return;
    retention.capacity = undefined;
    const index = snapshot.displayCount
      ? retention.index(snapshot.rootCount)
      : undefined;
    const demands = new Map<string, ModelBlock>();
    for (
      let rank = next.start;
      index && rank < Math.min(next.end, index.rowCount);
      rank++
    ) {
      const address = index.at(rank)!;
      const route =
        address.parent === null
          ? []
          : retention.groups.get(address.parent)!.route;
      const start = Math.floor(address.ordinal / blockSize) * blockSize;
      const block = { route, start, end: start + blockSize };
      demands.set(rangeAddress(route, start, block.end), block);
      if (demands.size > 64) {
        retention.capacity = "minimum-visible-too-large";
        refuseViewport();
        return;
      }
    }
    const metadata = {
      scope: -1,
      key: "viewport",
      kind: "external" as const,
      value: undefined,
      metadataBytes:
        wireBytes([...demands.values()]) * 2 +
        [...demands.keys()].reduce((bytes, key) => bytes + 8 * key.length, 0),
    };
    const plan = retention.prepare({
      additions: [metadata],
      protectedRanges: new Set(demands.keys()),
    });
    if (!apply(plan)) {
      refuseViewport();
      return;
    }
    viewport = requestedViewport;
    refusedViewport = undefined;
    wanted = demands;
    sessionController.cancelReadsExcept(new Set(demands.keys()));
    if (disposed || expectedCommand !== command) return;
    scheduler.replaceDemand(
      "viewport",
      [...demands.keys()].map((key) => ({
        generation: snapshot.generation,
        kind: "read",
        key,
        priority: "visible",
      })),
    );
    for (const key of [...pending.keys()])
      if (!demands.has(key)) pending.delete(key);
    const generation = snapshot.generation;
    for (const [key, block] of demands) {
      if (pending.has(key) || retention.cache.get(retention.visible, key))
        continue;
      const promise = sessionController.read(
        block.route,
        block.start,
        block.end,
      );
      if (disposed || expectedCommand !== command) {
        await promise;
        return;
      }
      pending.set(key, promise);
      void promise.finally(() => {
        if (
          !disposed &&
          sessionController.getSnapshot().generation === generation &&
          pending.get(key) === promise
        ) {
          pending.delete(key);
          publish();
        }
      });
    }
    publish();
    await Promise.all(pending.values());
  }
  function setExpanded(id: string, expanded: boolean) {
    if (disposed || typeof id !== "string" || !id) return false;
    if (retention.expanded.has(id) === expanded) return true;
    const expectedCommand = command;
    const next = new Set(retention.expanded);
    if (expanded) next.add(id);
    else next.delete(id);
    const key = `expanded:${id}`;
    const plan = retention.prepare({
      expanded: next,
      additions: expanded
        ? [
            {
              scope: -1,
              key,
              kind: "expansion",
              value: id,
              metadataBytes: 64 + 4 * id.length,
            },
          ]
        : [],
      drops: expanded ? [] : [{ scope: -1, key }],
    });
    if (!plan) {
      publish();
      return false;
    }
    try {
      if (snapshot.displayCount)
        retention.index(snapshot.rootCount, plan.groups, next);
    } catch {
      retention.capacity = "intent-capacity";
      plan.discard();
      publish();
      return false;
    }
    if (!apply(plan)) return false;
    const index = snapshot.displayCount
      ? retention.index(snapshot.rootCount)
      : undefined;
    const reachable = new Set(
      [...wanted]
        .filter(
          ([, block]) =>
            !block.route.length ||
            index?.rank(remoteGroupId(block.route), 0) !== undefined,
        )
        .map(([key]) => key),
    );
    sessionController.cancelReadsExcept(reachable);
    if (disposed || expectedCommand !== command) return true;
    for (const key of pending.keys())
      if (!reachable.has(key)) pending.delete(key);
    viewport = undefined;
    refusedViewport = undefined;
    publish();
    return true;
  }
  async function requestSummary(scope: "filtered" | "all") {
    if (disposed || provider.capabilities.summaries[scope] !== "same-version")
      return;
    if (summaryPending.has(scope)) {
      await summaryPending.get(scope);
      return;
    }
    if (snapshot.getSummary(scope).state === "ready") return;
    const generation = snapshot.generation;
    const expectedCommand = command;
    const promise = sessionController.summary(scope);
    if (disposed || expectedCommand !== command) {
      await promise;
      return;
    }
    summaryPending.set(scope, promise);
    publish();
    try {
      await promise;
    } finally {
      if (
        !disposed &&
        snapshot.generation === generation &&
        summaryPending.get(scope) === promise
      ) {
        summaryPending.delete(scope);
        publish();
      }
    }
  }
  return {
    getSnapshot: () => snapshot,
    getStatus: () => snapshot.status,
    getSlot: (index) => snapshot.readSlot(index),
    readSlot: (index) => snapshot.readSlot(index),
    subscribe(listener) {
      if (disposed) return () => {};
      if (!listeners.has(listener)) {
        const key = `listener:${++listenerSequence}`;
        if (listeners.size >= 256)
          throw new RangeError("Remote subscription capacity");
        const plan = retention.prepare({
          additions: [
            {
              scope: -1,
              key,
              kind: "external",
              value: undefined,
              metadataBytes: 128,
            },
          ],
        });
        if (!apply(plan)) throw new RangeError("Remote subscription capacity");
        listeners.add(listener);
        listenerKeys.set(listener, key);
        if (plan?.evictions.length) publish();
      }
      return () => {
        listeners.delete(listener);
        const key = listenerKeys.get(listener);
        if (key) retention.dropGlobal(key);
        listenerKeys.delete(listener);
        scheduler.wake();
      };
    },
    setQuery,
    refresh: () => (query ? setQuery(query, true) : Promise.resolve()),
    demandViewport,
    setExpanded,
    requestSummary,
    async retry() {
      if (disposed) return;
      const expectedCommand = command;
      retention.capacity = undefined;
      publish();
      if (disposed || command !== expectedCommand) return;
      if (snapshot.status.state !== "ready") {
        if (query) await setQuery(query, true);
      } else {
        const work: Promise<void>[] = [];
        const saved = refusedViewport ?? viewport;
        if (saved) work.push(demandViewport(saved, true));
        for (const scope of ["filtered", "all"] as const)
          if (
            refusedSummaries.has(scope) ||
            snapshot.getSummary(scope).state === "error"
          )
            work.push(requestSummary(scope));
        await Promise.all(work);
      }
    },
    checkExpiry: () => {
      if (!disposed) sessionController.checkExpiry();
    },
    getDiagnostics() {
      const cache = retention.cache.snapshot(),
        schedulerState = scheduler.getSnapshot();
      return Object.freeze({
        scopes: cache.scopes,
        payloadEntries: cache.payloadEntries,
        payloadBytes: cache.payloadBytes,
        metadataBytes: cache.metadataBytes,
        ingressBytes: cache.ingressBytes,
        topology: cache.topology,
        expansions: cache.expansions,
        stores: cache.stores,
        active: schedulerState.active,
        queued: schedulerState.queued,
        subscribers: schedulerState.subscribers,
        evidenceNodes: sessionController.retention().nodes,
        listeners: listeners.size,
        ...(retention.capacity ? { capacity: retention.capacity } : {}),
      });
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      command++;
      listeners.clear();
      for (const key of listenerKeys.values()) retention.dropGlobal(key);
      listenerKeys.clear();
      pending.clear();
      summaryPending.clear();
      refusedSummaries.clear();
      wanted.clear();
      viewport = undefined;
      refusedViewport = undefined;
      sessionController.dispose();
      scheduler.dispose();
      retention.clearBodies();
      retention.clearIntent();
      retention.dropGlobal("viewport");
      retention.dropGlobal("configuration");
      query = undefined;
      viewQuery = undefined;
      queryKey = undefined;
      snapshot = createModelView(
        sessionController.getSnapshot(),
        retention,
        undefined,
        provider.capabilities,
        new Set(),
        new Set(),
        blockSize,
      );
    },
  };
}
