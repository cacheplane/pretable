import { describe, expect, test } from "vitest";

import { formatChange, formatTime, formatVolume } from "./format";

describe("formatVolume", () => {
  test("B suffix", () => {
    expect(formatVolume(2_500_000_000)).toBe("2.5B");
  });
  test("M suffix", () => {
    expect(formatVolume(48_200_000)).toBe("48.2M");
  });
  test("K suffix", () => {
    expect(formatVolume(12_345)).toBe("12.3K");
  });
  test("bare number", () => {
    expect(formatVolume(500)).toBe("500");
  });
});

describe("formatChange", () => {
  test("positive with plus sign", () => {
    expect(formatChange(2.345)).toBe("+2.35%");
  });
  test("negative with minus", () => {
    expect(formatChange(-0.1)).toBe("-0.10%");
  });
  test("zero", () => {
    expect(formatChange(0)).toBe("+0.00%");
  });
});

describe("formatTime", () => {
  test("pads seconds", () => {
    expect(formatTime(65)).toBe("1:05");
  });
  test("zero", () => {
    expect(formatTime(0)).toBe("0:00");
  });
});
