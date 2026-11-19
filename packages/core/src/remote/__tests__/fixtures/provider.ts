import type {
  PretableRemoteCapabilities,
  PretableRemoteProvider,
  PretableRemoteQuery,
  PretableRemoteRange,
  PretableRemoteRangeRequest,
  PretableRemoteResult,
  PretableRemoteSession,
  PretableRemoteSignal,
  PretableRemoteSummary,
} from "../../types";

interface Pending<Request, Response> {
  readonly request: Request;
  readonly signal: PretableRemoteSignal;
  resolve(result: PretableRemoteResult<Response>): void;
}

/** Core-only controlled transport fixture, with no website import or runtime export.
 * Default ignores abort deliberately: consumers must reject late old-generation data. */
export function createDeferredProvider<TRow extends object, TColumns>(
  capabilities: PretableRemoteCapabilities,
  options: { honorAbort?: boolean } = {},
) {
  const opens: Pending<
    { query: PretableRemoteQuery<TColumns>; queryKey: string },
    PretableRemoteSession
  >[] = [];
  const reads: Pending<
    PretableRemoteRangeRequest,
    PretableRemoteRange<TRow>
  >[] = [];
  const summaries: Pending<
    { session: PretableRemoteSession; scope: "filtered" | "all" },
    PretableRemoteSummary
  >[] = [];
  const released: PretableRemoteSession[] = [];
  function enqueue<Request, Response>(
    queue: Pending<Request, Response>[],
    request: Request,
    signal: PretableRemoteSignal,
  ) {
    return new Promise<PretableRemoteResult<Response>>((resolve) => {
      let settled = false;
      const finish = (result: PretableRemoteResult<Response>) => {
        if (settled) return;
        settled = true;
        signal.removeEventListener("abort", abort);
        resolve(result);
      };
      const abort = () => finish({ ok: false, error: { code: "cancelled" } });
      queue.push({ request, signal, resolve: finish });
      if (options.honorAbort) {
        if (signal.aborted) abort();
        else signal.addEventListener("abort", abort, { once: true });
      }
    });
  }
  const provider: PretableRemoteProvider<TRow, TColumns> = {
    capabilities,
    open: (query, queryKey, signal) =>
      enqueue(opens, { query, queryKey }, signal),
    read: (request, signal) => enqueue(reads, request, signal),
    summary: (session, scope, signal) =>
      enqueue(summaries, { session, scope }, signal),
    async release(session) {
      released.push(session);
    },
  };
  return { provider, opens, reads, summaries, released };
}
