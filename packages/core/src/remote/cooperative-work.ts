import type { PretableRemoteSignal } from "./types";

/** Bounded preparation only. Published state is never mutated by these steps.
 * Timer tasks yield to rendering/input; promise-only yields would not. */
export function prepareCooperatively<T>(
  steps: Generator<void, T>,
  signal: PretableRemoteSignal,
  current: () => boolean,
): Promise<{ ok: true; value: T } | { ok: false }> {
  return new Promise((resolve, reject) => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    let finished = false;
    const cleanup = () => {
      finished = true;
      if (timer !== undefined) clearTimeout(timer);
      timer = undefined;
      signal.removeEventListener("abort", cancel);
    };
    const cancel = () => {
      if (finished) return;
      cleanup();
      try {
        steps.return(undefined as T);
      } catch {
        /* Discard only. */
      }
      resolve({ ok: false });
    };
    const run = () => {
      timer = undefined;
      if (finished) return;
      try {
        if (signal.aborted || !current()) {
          cancel();
          return;
        }
        for (let work = 0; work < 1024; work++) {
          const step = steps.next();
          if (finished) {
            steps.return(undefined as T);
            return;
          }
          if (step.done) {
            cleanup();
            resolve({ ok: true, value: step.value });
            return;
          }
        }
        timer = setTimeout(run, 0);
      } catch (error) {
        cleanup();
        reject(error);
      }
    };
    signal.addEventListener("abort", cancel, { once: true });
    run();
  });
}

/** One owned-copy stage across sessions. Incoming bodies already hold physical
 * ingress reservations; queued jobs own only their charged request descriptor. */
export function createPreparationQueue() {
  type Job = {
    signal: PretableRemoteSignal;
    work: (() => Promise<void>) | undefined;
    resolve: () => void;
    reject: (reason: unknown) => void;
    cancel: () => void;
  };
  const queued = new Set<Job>();
  let active = false;
  function pump() {
    if (active) return;
    const job = queued.values().next().value;
    if (!job) return;
    queued.delete(job);
    job.signal.removeEventListener("abort", job.cancel);
    const work = job.work;
    job.work = undefined;
    if (job.signal.aborted || !work) {
      job.resolve();
      pump();
      return;
    }
    active = true;
    let pending: Promise<void>;
    try {
      pending = work();
    } catch (error) {
      pending = Promise.reject(error);
    }
    void pending.then(job.resolve, job.reject).finally(() => {
      active = false;
      pump();
    });
  }
  return (
    signal: PretableRemoteSignal,
    work: () => Promise<void>,
  ): Promise<void> => {
    if (signal.aborted || queued.size + Number(active) >= 4)
      return Promise.resolve();
    return new Promise((resolve, reject) => {
      const job: Job = { signal, work, resolve, reject, cancel: () => {} };
      job.cancel = () => {
        queued.delete(job);
        job.work = undefined;
        signal.removeEventListener("abort", job.cancel);
        resolve();
      };
      queued.add(job);
      signal.addEventListener("abort", job.cancel, { once: true });
      pump();
    });
  };
}
