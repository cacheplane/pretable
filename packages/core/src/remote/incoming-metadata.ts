import { cacheRecordMetadata } from "./cache";
import { remoteGroupId } from "./query";
import { rangeAddress } from "./validate-response";
import { wireBytesSteps } from "./wire-cost";
import type { PretableRemoteRange, PretableRemoteSummary } from "./types";
/** Full incoming prepaid metadata, before allocating validation/retention indexes.
 * Bodies remain exclusively under ingress ownership. Values are owned plain wire
 * snapshots; node-specific protocol validation follows this credit calculation. */
export function* incomingMetadataSteps<TRow extends object>(
  generation: number,
  value: PretableRemoteRange<TRow> | PretableRemoteSummary,
  ownedBytes: number,
): Generator<void, number> {
  if ("scope" in value)
    return cacheRecordMetadata({
      scope: generation,
      key: `summary:${value.scope}`,
      kind: "external",
      value: undefined,
      metadataBytes: ownedBytes * 2,
    });
  const key = rangeAddress(value.route, value.start, value.end);
  let bytes = cacheRecordMetadata({
    scope: generation,
    key,
    kind: "payload",
    value: undefined,
    metadataBytes:
      192 +
      264 * value.entries.length +
      (yield* wireBytesSteps(value.route)) +
      16 * key.length,
    address: {
      generation,
      route: value.route,
      start: value.start,
      end: value.end,
    },
  });
  const parent = value.route.length ? remoteGroupId(value.route) : null;
  for (const [offset, node] of value.entries.entries()) {
    yield;
    if (!node || node.kind !== "group") continue;
    const group = {
      id: node.id,
      parent,
      ordinal: value.start + offset,
      route: node.route,
      childCount: node.childCount,
    };
    bytes += cacheRecordMetadata({
      scope: generation,
      key: `topology:${node.id}`,
      kind: "topology",
      value: undefined,
      metadataBytes: 2 * (yield* wireBytesSteps(group)),
    });
  }
  return bytes;
}
