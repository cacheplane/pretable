import type { ChatRow } from "./columns";

export interface ChatResponseEvent {
  readonly type: string;
  readonly delta?: unknown;
  readonly response?: {
    readonly id?: unknown;
    readonly usage?: {
      readonly output_tokens?: unknown;
    } | null;
  };
}

export interface ResponseEventsToChatRowsOptions {
  readonly now?: () => number;
}

function responseId(event: ChatResponseEvent): string | undefined {
  const id = event.response?.id;
  return typeof id === "string" && id.length > 0 ? id : undefined;
}

function outputTokens(event: ChatResponseEvent): number {
  const tokens = event.response?.usage?.output_tokens;
  return typeof tokens === "number" && Number.isFinite(tokens) && tokens >= 0
    ? Math.trunc(tokens)
    : 0;
}

/** Converts Responses API events into complete rows for connectElementStream. */
export async function* responseEventsToChatRows(
  events: AsyncIterable<ChatResponseEvent>,
  options: ResponseEventsToChatRowsOptions = {},
): AsyncIterable<ChatRow> {
  const now = options.now ?? performance.now.bind(performance);
  let id: string | undefined;
  let content = "";
  let startedAt: number | undefined;

  for await (const event of events) {
    if (event.type === "response.created") {
      id = responseId(event);
      content = "";
      startedAt = now();
      continue;
    }

    if (
      event.type === "response.output_text.delta" &&
      typeof event.delta === "string"
    ) {
      content += event.delta;
      continue;
    }

    if (event.type !== "response.completed") continue;

    const completedId = responseId(event) ?? id;
    const completedAt = now();
    const rowContent = content;
    const latencyMs =
      startedAt === undefined
        ? 0
        : Math.max(0, Math.round(completedAt - startedAt));
    id = undefined;
    content = "";
    startedAt = undefined;

    if (completedId === undefined) continue;
    yield {
      id: completedId,
      role: "assistant",
      content: rowContent,
      tokens: outputTokens(event),
      latencyMs,
    };
  }
}
