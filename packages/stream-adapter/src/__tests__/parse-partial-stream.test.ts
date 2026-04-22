import { describe, expect, test } from "vitest";
import { parsePartialStream } from "../parse-partial-stream";

interface TestRow {
  id: string;
  name: string;
  score: number;
}

async function* asyncChunks(chunks: string[]): AsyncIterable<string> {
  for (const chunk of chunks) {
    yield chunk;
  }
}

async function collect<T>(iterable: AsyncIterable<T>): Promise<T[]> {
  const results: T[] = [];
  for await (const item of iterable) {
    results.push(item);
  }
  return results;
}

describe("parsePartialStream", () => {
  test("yields partial object snapshots as properties complete", async () => {
    const chunks = [
      '{"id":"1"',
      ',"name":"Ali',
      'ce","score":',
      "100}",
    ];

    const results = await collect(
      parsePartialStream<TestRow>(asyncChunks(chunks)),
    );

    expect(results.length).toBeGreaterThanOrEqual(1);

    const last = results[results.length - 1];
    expect(last).toEqual({ id: "1", name: "Alice", score: 100 });
  });

  test("only yields when resolved value reference changes (identity-preserving)", async () => {
    const chunks = [
      '{"id":"1",',
      ' ',
      ' ',
      '"name":"Alice"}',
    ];

    const results = await collect(
      parsePartialStream<TestRow>(asyncChunks(chunks)),
    );

    for (let i = 1; i < results.length; i++) {
      expect(results[i]).not.toBe(results[i - 1]);
    }
  });

  test("handles chunk boundaries within the object", async () => {
    const json = '{"id":"1","name":"Alice","score":100}';
    const chunks = json.split("");

    const results = await collect(
      parsePartialStream<TestRow>(asyncChunks(chunks)),
    );

    expect(results.length).toBeGreaterThanOrEqual(1);
    const last = results[results.length - 1];
    expect(last).toEqual({ id: "1", name: "Alice", score: 100 });
  });

  test("throws if root is an array", async () => {
    const chunks = ["[1, 2, 3]"];

    await expect(
      collect(parsePartialStream<TestRow>(asyncChunks(chunks))),
    ).rejects.toThrow("object");
  });

  test("throws if root is a primitive", async () => {
    const chunks = ['"hello"'];

    await expect(
      collect(parsePartialStream<TestRow>(asyncChunks(chunks))),
    ).rejects.toThrow("object");
  });

  test("single chunk complete object yields at least one snapshot", async () => {
    const chunks = ['{"id":"1","name":"Alice","score":100}'];

    const results = await collect(
      parsePartialStream<TestRow>(asyncChunks(chunks)),
    );

    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results[results.length - 1]).toEqual({
      id: "1",
      name: "Alice",
      score: 100,
    });
  });
});
