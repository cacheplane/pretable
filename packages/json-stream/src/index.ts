export type {
  AstNode,
  ArrayNode,
  BoolNode,
  JsonValue,
  NodeStatus,
  NullNode,
  NumberNode,
  ObjectNode,
  StreamError,
  StreamState,
  StringNode,
} from "./types";

export {
  isArrayNode,
  isBoolNode,
  isComplete,
  isNullNode,
  isNumberNode,
  isObjectNode,
  isStringNode,
} from "./guards";

export { resolve } from "./resolve";

import { createInternal } from "./create";
import type { StreamState } from "./types";

export function create(): StreamState {
  return createInternal();
}
