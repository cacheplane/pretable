import { describe, expect, expectTypeOf, test, vi } from "vitest";

import type { ChatRow } from "../columns";
import {
  responseEventsToChatRows,
  type ChatResponseEvent,
} from "../response-events-to-chat-rows";

async function* events(
  values: readonly ChatResponseEvent[],
): AsyncIterable<ChatResponseEvent> {
  yield* values;
}

describe("responseEventsToChatRows", () => {
  test("emits one complete row only after a response completes", async () => {
    const stream = responseEventsToChatRows(
      events([
        { type: "response.created", response: { id: "resp_1" } },
        { type: "response.output_text.delta", delta: "Hello " },
        { type: "response.output_text.delta", delta: "world" },
        {
          type: "response.completed",
          response: { id: "resp_1", usage: { output_tokens: 2 } },
        },
      ]),
      { now: vi.fn().mockReturnValueOnce(100).mockReturnValueOnce(145) },
    );
    expectTypeOf(stream).toEqualTypeOf<AsyncIterable<ChatRow>>();

    const rows = await Array.fromAsync(stream);

    expect(rows).toEqual([
      {
        id: "resp_1",
        role: "assistant",
        content: "Hello world",
        tokens: 2,
        latencyMs: 45,
      },
    ]);
  });

  test("never emits an event that lacks the required row identity", async () => {
    const rows = await Array.fromAsync(
      responseEventsToChatRows(
        events([
          { type: "response.output_text.delta", delta: "orphan" },
          { type: "response.completed", response: { usage: null } },
        ]),
      ),
    );

    expect(rows).toEqual([]);
  });
});
