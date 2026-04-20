import type {
  PrepareTextInput,
  PreparedText,
  PreparedTextToken,
} from "./types";

const DEFAULT_AVERAGE_CHAR_WIDTH = 7;

export function prepareText(input: PrepareTextInput): PreparedText {
  const text = input.text.replaceAll("\r\n", "\n");
  const graphemes = Array.from(text);

  return {
    text,
    fontKey: input.fontKey,
    graphemeCount: graphemes.length,
    breakpoints: collectBreakpoints(graphemes),
    averageCharWidth:
      input.averageCharWidth ?? estimateAverageCharWidth(input.fontKey),
    tokens: tokenizeText(text),
  };
}

function collectBreakpoints(graphemes: string[]): number[] {
  const breakpoints: number[] = [];

  for (let index = 0; index < graphemes.length; index += 1) {
    const value = graphemes[index];

    if (value === undefined) {
      continue;
    }

    if (/\s/u.test(value) || value === "-" || value === "/" || value === "_") {
      breakpoints.push(index + 1);
    }
  }

  return breakpoints;
}

function tokenizeText(text: string): PreparedTextToken[] {
  const matches = text.match(/\n|[^\S\n]+|[^\s]+/gu) ?? [];

  return matches.map((value) => {
    if (value === "\n") {
      return { kind: "newline", value, length: 0 };
    }

    if (/^[^\S\n]+$/u.test(value)) {
      return { kind: "space", value, length: Array.from(value).length };
    }

    return { kind: "word", value, length: Array.from(value).length };
  });
}

function estimateAverageCharWidth(fontKey: string): number {
  const normalized = fontKey.toLowerCase();

  if (normalized.includes("mono")) {
    return 8;
  }

  if (normalized.includes("condensed")) {
    return 6.5;
  }

  if (normalized.includes("serif")) {
    return 7.25;
  }

  return DEFAULT_AVERAGE_CHAR_WIDTH;
}
