import { useEffect, useRef } from "react";
import type { PretableSummaryScope } from "@pretable/core";
import { resolveSummaries, type ResolveSummariesInput } from "./summary";

interface SummaryOwner {
  acquireSummaryScopes?(scopes: readonly PretableSummaryScope[]): () => void;
}
/** Owns demand only in effects; reads only the caller's committed snapshot. */
export function useSummary(
  input: ResolveSummariesInput & { readonly model: SummaryOwner },
) {
  const lease = useRef<(() => void) | undefined>(undefined);
  const filtered = input.summaries?.filtered?.authority === "engine";
  const all = input.summaries?.all?.authority === "engine";
  // No dependency cleanup: that would release the previous scope before its
  // replacement is acquired, dropping a shared root during a scope transition.
  useEffect(() => {
    const scopes: PretableSummaryScope[] = [];
    if (filtered) scopes.push("filtered");
    if (all) scopes.push("all");
    const next = scopes.length
      ? input.model.acquireSummaryScopes?.(scopes)
      : undefined;
    const previous = lease.current;
    lease.current = next;
    previous?.();
  }, [input.model, filtered, all]);
  // Separate lifetime cleanup also tolerates StrictMode's setup/cleanup replay.
  useEffect(
    () => () => {
      lease.current?.();
      lease.current = undefined;
    },
    [],
  );
  return resolveSummaries(input);
}
