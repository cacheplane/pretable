import type { PretableRemoteSignal } from "./types";

export interface AcceptanceDeadline {
  readonly at: number;
  readonly clock: {
    now(): number;
    setTimeout(callback: () => void, delay: number): unknown;
    clearTimeout(handle: unknown): void;
  };
}
/** Transport settlement does not end operation ownership while acceptance is
 * staged. Keep its original monotonic deadline, separate from session expiry. */
export function createAcceptanceDeadline(
  signal: PretableRemoteSignal,
  deadline: AcceptanceDeadline | undefined,
  owns: () => boolean,
  expire: () => void,
) {
  let disposed = false;
  let timer: unknown;
  const dispose = () => {
    disposed = true;
    signal.removeEventListener("abort", dispose);
    if (timer !== undefined && deadline) {
      const handle = timer;
      timer = undefined;
      try {
        deadline.clock.clearTimeout(handle);
      } catch {
        /* Cleanup isolation. */
      }
    }
  };
  const current = () => {
    if (disposed || signal.aborted || !owns()) return false;
    if (!deadline) return true;
    let now: number;
    try {
      now = deadline.clock.now();
    } catch {
      now = Infinity;
    }
    if (disposed || signal.aborted || !owns()) return false;
    if (!Number.isFinite(now) || now >= deadline.at) {
      dispose();
      expire();
      return false;
    }
    return true;
  };
  const arm = () => {
    timer = undefined;
    if (!current() || !deadline) return;
    let remaining: number;
    try {
      remaining = deadline.at - deadline.clock.now();
    } catch {
      remaining = 0;
    }
    if (!current()) return;
    try {
      timer = deadline.clock.setTimeout(arm, Math.max(0, remaining));
    } catch {
      dispose();
      expire();
      return;
    }
    if (!current()) dispose();
  };
  signal.addEventListener("abort", dispose, { once: true });
  arm();
  return { current, dispose };
}
