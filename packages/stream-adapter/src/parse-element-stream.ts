import {
  create,
  push,
  finish,
  isArrayNode,
  isComplete,
} from "@cacheplane/json-stream";
import type { StreamState } from "@cacheplane/json-stream";

/**
 * Parse a UTF-8 string stream into an `AsyncIterable<TRow>`. Built on
 * `@cacheplane/json-stream`'s incremental JSON parser; emits each
 * complete top-level array element as a typed row.
 *
 * Pair with {@link connectElementStream} for end-to-end element-stream
 * → grid wiring.
 *
 * @public
 */
export async function* parseElementStream<TRow>(
  stream: AsyncIterable<string>,
): AsyncIterable<TRow> {
  let state: StreamState = create();
  let yieldedCount = 0;

  for await (const chunk of stream) {
    state = push(state, chunk);

    if (state.error) {
      throw new Error(state.error.message);
    }

    if (state.rootId !== null) {
      const root = state.nodes[state.rootId];
      if (!isArrayNode(root)) {
        throw new Error(
          `parseElementStream expects root to be an array, got "${root.kind}"`,
        );
      }

      while (yieldedCount < root.children.length) {
        const childNode = state.nodes[root.children[yieldedCount]];
        if (!isComplete(childNode)) break;
        if (childNode.value !== undefined) {
          yield childNode.value as TRow;
        }
        yieldedCount++;
      }
    }
  }

  state = finish(state);

  if (state.error) {
    throw new Error(state.error.message);
  }

  if (state.rootId !== null) {
    const root = state.nodes[state.rootId];
    if (isArrayNode(root)) {
      while (yieldedCount < root.children.length) {
        const childNode = state.nodes[root.children[yieldedCount]];
        if (isComplete(childNode) && childNode.value !== undefined) {
          yield childNode.value as TRow;
        }
        yieldedCount++;
      }
    }
  }
}
