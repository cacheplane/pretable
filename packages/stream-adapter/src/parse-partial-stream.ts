import {
  create,
  push,
  finish,
  isObjectNode,
} from "@cacheplane/json-stream";
import type { StreamState } from "@cacheplane/json-stream";

export async function* parsePartialStream<TRow>(
  stream: AsyncIterable<string>,
): AsyncIterable<Partial<TRow>> {
  let state: StreamState = create();
  let lastValue: Record<string, unknown> | undefined;

  for await (const chunk of stream) {
    state = push(state, chunk);

    if (state.error) {
      throw new Error(state.error.message);
    }

    if (state.rootId !== null) {
      const root = state.nodes[state.rootId];
      if (!isObjectNode(root)) {
        throw new Error(
          `parsePartialStream expects root to be an object, got "${root.kind}"`,
        );
      }

      if (root.value !== undefined && root.value !== lastValue) {
        lastValue = root.value;
        yield root.value as Partial<TRow>;
      }
    }
  }

  state = finish(state);

  if (state.error) {
    throw new Error(state.error.message);
  }

  if (state.rootId !== null) {
    const root = state.nodes[state.rootId];
    if (isObjectNode(root) && root.value !== undefined && root.value !== lastValue) {
      yield root.value as Partial<TRow>;
    }
  }
}
