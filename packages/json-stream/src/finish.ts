import type { InternalState } from "./types";
import { closePrimitive, toErrorState, afterValue } from "./internals";

const NUMBER_RE = /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?$/;

export function finishInternal(state: InternalState): InternalState {
  if (state.error) return state;
  if (state.mode === "Done") return state;

  switch (state.mode) {
    case "NumberValue": {
      const nodeId = state.currentNodeId!;
      const node = state.nodes[nodeId] as { buffer: string };
      const buf = node.buffer;
      if (!NUMBER_RE.test(buf)) {
        return toErrorState(state, `Invalid number at end of input: "${buf}"`);
      }
      const value = parseFloat(buf);
      const s1 = closePrimitive(state, nodeId, value);
      const { mode, complete } = afterValue(s1.stack);
      return { ...s1, mode, complete };
    }

    case "LiteralValue":
      return toErrorState(state, "Unexpected end of input while parsing literal");

    case "StringValue":
      return toErrorState(state, "Unexpected end of input while parsing string");

    case "Value":
      if (state.rootId === null) {
        return toErrorState(state, "Unexpected end of input: no value");
      }
      return toErrorState(state, "Unexpected end of input");

    case "Separator":
    case "ArrayItemOrEnd":
    case "ObjectKeyOrEnd":
    case "ObjectKey":
    case "ObjectColon":
      return toErrorState(state, "Unexpected end of input: unclosed container");

    default:
      return toErrorState(state, "Unexpected end of input");
  }
}
