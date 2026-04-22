import { describe, expect, test } from "vitest";
import { parseElementStream } from "../parse-element-stream";

interface TestRow {
  id: string;
  name: string;
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

describe("parseElementStream", () => {
  test("yields complete elements from a JSON array", async () => {
    const chunks = ['[{"id":"1","name":"Alice"},{"id":"2","name":"Bob"}]'];
    const results = await collect(
      parseElementStream<TestRow>(asyncChunks(chunks)),
    );

    expect(results).toEqual([
      { id: "1", name: "Alice" },
      { id: "2", name: "Bob" },
    ]);
  });

  test("handles chunk boundaries within elements", async () => {
    const chunks = [
      '[{"id":"1","na',
      'me":"Alice"},{"id',
      '":"2","name":"Bob"}]',
    ];
    const results = await collect(
      parseElementStream<TestRow>(asyncChunks(chunks)),
    );

    expect(results).toEqual([
      { id: "1", name: "Alice" },
      { id: "2", name: "Bob" },
    ]);
  });

  test("yields nothing until first element is complete", async () => {
    const yielded: TestRow[] = [];

    async function* slowChunks(): AsyncIterable<string> {
      yield '[{"id":"1"';
      yield ',"name":"Alice"}';
      yield "]";
    }

    for await (const row of parseElementStream<TestRow>(slowChunks())) {
      yielded.push(row);
    }

    expect(yielded).toEqual([{ id: "1", name: "Alice" }]);
  });

  test("yields elements one at a time as they complete", async () => {
    const chunks = [
      '[{"id":"1","name":"Alice"}',
      ',{"id":"2","name":"Bob"}',
      ",",
      '{"id":"3","name":"Carol"}]',
    ];

    const results = await collect(
      parseElementStream<TestRow>(asyncChunks(chunks)),
    );
    expect(results).toHaveLength(3);
  });

  test("handles empty array", async () => {
    const chunks = ["[]"];
    const results = await collect(
      parseElementStream<TestRow>(asyncChunks(chunks)),
    );
    expect(results).toEqual([]);
  });

  test("handles nested objects in elements", async () => {
    interface NestedRow {
      id: string;
      meta: { score: number };
    }
    const chunks = ['[{"id":"1","meta":{"score":100}}]'];
    const results = await collect(
      parseElementStream<NestedRow>(asyncChunks(chunks)),
    );
    expect(results).toEqual([{ id: "1", meta: { score: 100 } }]);
  });

  test("character-at-a-time streaming", async () => {
    const json = '[{"id":"1","name":"Alice"}]';
    const chunks = json.split("");
    const results = await collect(
      parseElementStream<TestRow>(asyncChunks(chunks)),
    );
    expect(results).toEqual([{ id: "1", name: "Alice" }]);
  });
});
