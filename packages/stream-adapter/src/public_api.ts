/**
 * Public API of `@pretable/stream-adapter`. Hand-curated re-exports —
 * do not edit `index.ts` directly.
 *
 * @packageDocumentation
 */

export { createBatcher } from "./create-batcher";
export { connectElementStream } from "./connect-element-stream";
export { connectPartialStream } from "./connect-partial-stream";
export type { PartialStreamOptions } from "./connect-partial-stream";
export { parseElementStream } from "./parse-element-stream";
export { parsePartialStream } from "./parse-partial-stream";
export type { GridLike, StreamConnection, TransactionBatcher } from "./types";
