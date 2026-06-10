import { describe, expect, it } from "vitest";
import { generatePortfolioRecording } from "../generate-portfolio";

describe("generatePortfolioRecording", () => {
  it("is deterministic for a fixed seed", () => {
    expect(generatePortfolioRecording()).toBe(generatePortfolioRecording());
  });

  it("emits a Phase-1 element stream that parses into the full roster", () => {
    const lines = generatePortfolioRecording().trim().split("\n").map((l) => JSON.parse(l));
    const deltas = lines.filter((e) => e.type === "response.output_text.delta").map((e) => e.delta);
    const parsed = JSON.parse(deltas.join(""));
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed.length).toBe(20);
    expect(parsed[0]).toMatchObject({ id: "NVDA", symbol: "NVDA", flag: "hold", analyst: "" });
  });

  it("emits tick and commentary events with id-keyed patches", () => {
    const lines = generatePortfolioRecording().trim().split("\n").map((l) => JSON.parse(l));
    const ticks = lines.filter((e) => e.type === "tick");
    const commentary = lines.filter((e) => e.type === "commentary");
    expect(ticks.length).toBeGreaterThan(100);
    expect(commentary.length).toBeGreaterThan(8);
    for (const ev of [...ticks, ...commentary]) {
      expect(typeof ev.t).toBe("number");
      expect(Array.isArray(ev.patches)).toBe(true);
      expect(typeof ev.patches[0].id).toBe("string");
    }
  });

  it("tick patches carry numeric last/mktValue/dayPnl", () => {
    const tick = generatePortfolioRecording().trim().split("\n").map((l) => JSON.parse(l))
      .find((e) => e.type === "tick");
    expect(typeof tick.patches[0].last).toBe("number");
    expect(typeof tick.patches[0].mktValue).toBe("number");
    expect(typeof tick.patches[0].dayPnl).toBe("number");
  });
});
