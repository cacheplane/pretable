import type { OpenChatResponseEvents } from "./ChatGrid";

interface ScriptedResponse {
  readonly id: string;
  readonly chunks: readonly string[];
  readonly outputTokens: number;
}

const SCRIPT: readonly ScriptedResponse[] = [
  {
    id: "resp_1",
    chunks: ["10 incidents ", "over 30 days; ", "6 latency, 4 errors."],
    outputTokens: 15,
  },
  {
    id: "resp_2",
    chunks: ["Top driver: ", "cold-start regressions ", "on the bench worker."],
    outputTokens: 11,
  },
  {
    id: "resp_3",
    chunks: ["Recommend pinning ", "the bench-worker pool size."],
    outputTokens: 8,
  },
];

const DEFAULT_INTERVAL_MS = 220;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Builds a deterministic stand-in for `openai.responses.stream(...)`. It
 * yields the same lifecycle and text-delta events a real Responses API
 * stream would — `response.created`, then `response.output_text.delta`
 * chunks, then `response.completed` — paced with a delay so rows visibly
 * arrive one at a time instead of all at once.
 *
 * Everything downstream of `openResponseEvents` (the `ChatGrid` prop this
 * satisfies) is unchanged in a real app: swap this generator for a real
 * network call — `openai.responses.stream(...)`, `fromEventSource(...)`, or
 * `parseElementStream` over a decoded `fetch` body — and the row-by-row
 * rendering keeps working exactly as it does here.
 */
export function createScriptedResponseEvents(
  intervalMs: number = DEFAULT_INTERVAL_MS,
): OpenChatResponseEvents {
  return async function* scriptedResponseEvents() {
    for (const response of SCRIPT) {
      yield { type: "response.created", response: { id: response.id } };
      await sleep(intervalMs);
      for (const chunk of response.chunks) {
        yield { type: "response.output_text.delta", delta: chunk };
        await sleep(intervalMs);
      }
      yield {
        type: "response.completed",
        response: {
          id: response.id,
          usage: { output_tokens: response.outputTokens },
        },
      };
      await sleep(intervalMs);
    }
  };
}

/** The pacing used by the live demo. */
export const scriptedResponseEvents: OpenChatResponseEvents =
  createScriptedResponseEvents();
