import { describe, expect, it } from "vitest";

import { generateRaceRecording } from "../generate-race";

describe("generateRaceRecording", () => {
  it("is deterministic — two runs produce byte-identical output", () => {
    const a = generateRaceRecording();
    const b = generateRaceRecording();
    expect(a).toEqual(b);
  });

  it("starts with a phase-1 response.created event", () => {
    const out = generateRaceRecording();
    const firstLine = out.split("\n")[0];
    expect(firstLine).toBeDefined();
    const parsed = JSON.parse(firstLine!);
    expect(parsed.type).toBe("response.created");
  });

  it("contains 30 racers in phase-1 output", () => {
    const out = generateRaceRecording();
    const lines = out
      .trim()
      .split("\n")
      .map((l) => JSON.parse(l));
    const phase1Deltas = lines
      .filter((l: { type: string }) => l.type === "response.output_text.delta")
      .map((l: { delta: string }) => l.delta)
      .join("");
    const racers = JSON.parse(phase1Deltas);
    expect(racers).toHaveLength(30);
  });
});
