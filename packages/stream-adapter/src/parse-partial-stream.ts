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

      // Skip the initial empty-object state — only yield once at least one
      // key has fully resolved. Without this guard, the very first yield
      // would be `{}`, which translates to spurious no-op transactions
      // downstream in connectPartialStream.
      if (
        root.value !== undefined &&
        root.value !== lastValue &&
        Object.keys(root.value).length > 0
      ) {
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
    if (
      isObjectNode(root) &&
      root.value !== undefined &&
      root.value !== lastValue &&
      Object.keys(root.value).length > 0
    ) {
      yield root.value as Partial<TRow>;
    }
  }
}
