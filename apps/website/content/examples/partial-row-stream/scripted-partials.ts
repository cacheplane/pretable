import type { MessageRow } from "./columns";

/** Partials for "msg-1", a row the demo seeds before the stream connects. */
export const FIRST_REPLY =
  "Hello! This row already existed, so the stream only ever patches it.";

/** Partials for "msg-2", a row that does not exist until createRow builds it. */
export const SECOND_REPLY =
  "This row did not exist yet. createRow made it from the first partial.";

export const INTERVAL_MS = 140;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Yields the growing prefix of `text`, one character at a time. Each
 * partial carries the *whole* value so far, not just the newly-added
 * slice — connectPartialStream applies `changes` as-is, it doesn't diff
 * against the previous partial, so the source is responsible for the
 * accumulation (the same shape a token-streamed LLM response takes once
 * you've concatenated its deltas).
 */
async function* growingContent(
  text: string,
  intervalMs: number,
): AsyncIterable<Partial<MessageRow>> {
  for (let i = 1; i <= text.length; i++) {
    yield { content: text.slice(0, i), tokens: i };
    await sleep(intervalMs);
  }
}

/** Drives "msg-1": a row that was seeded before this stream connects. */
export function scriptedFirstReply(): AsyncIterable<Partial<MessageRow>> {
  return growingContent(FIRST_REPLY, INTERVAL_MS);
}

/** Drives "msg-2": a row created on the fly by `createRow`. */
export function scriptedSecondReply(): AsyncIterable<Partial<MessageRow>> {
  return growingContent(SECOND_REPLY, INTERVAL_MS);
}
