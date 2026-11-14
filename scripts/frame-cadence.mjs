// Shared only by the permanent gate; ordinary browser tests keep their defaults.
export const ROW_MODEL_GATE_CONTEXT = Object.freeze({
  viewport: Object.freeze({ width: 1440, height: 900 }),
  deviceScaleFactor: 1,
});

const SAMPLE_COUNT = 120;
const WARMUP_FRAMES = 30;
const TIMEOUT_MS = 15_000;
const QUANTIZATION_ALLOWANCE_MS = 0.25;

export function deriveFrameCadence(calibration) {
  const samples = calibration?.intervalsMs;
  if (
    !Array.isArray(samples) ||
    samples.length < SAMPLE_COUNT ||
    Array.from(samples).some((value) => !Number.isFinite(value) || value <= 0)
  ) {
    throw new Error(
      "Frame calibration requires at least 120 finite positive intervals.",
    );
  }
  const sorted = [...samples].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  const medianMs =
    sorted.length % 2
      ? sorted[middle]
      : (sorted[middle - 1] + sorted[middle]) / 2;
  // Nearest-rank percentiles, matching the benchmark's interval distribution.
  const p05Ms = sorted[Math.ceil(sorted.length * 0.05) - 1];
  const p95Ms = sorted[Math.ceil(sorted.length * 0.95) - 1];
  if (medianMs < 4 || medianMs > 1000 / 60 + QUANTIZATION_ALLOWANCE_MS) {
    throw new Error(
      "Frame calibration cadence is outside the eligible 4–16.917 ms range.",
    );
  }
  if (p95Ms - p05Ms > 0.5) {
    throw new Error(
      "Frame calibration is too noisy: p95 minus p05 exceeds 0.5 ms.",
    );
  }
  return Object.freeze({
    medianMs,
    p05Ms,
    p95Ms,
    budgetMs: medianMs + QUANTIZATION_ALLOWANCE_MS,
    calibration,
  });
}

export function validateFrameCadence(calibration, { startedAt, summaries }) {
  const cadence = deriveFrameCadence(calibration);
  const timestamp = Date.parse(calibration.timestamp);
  const start = Date.parse(startedAt);
  if (
    !Number.isFinite(start) ||
    !Number.isFinite(timestamp) ||
    timestamp < start
  ) {
    throw new Error("Frame calibration is missing a valid fresh timestamp.");
  }
  if (
    calibration.browserName !== "chromium" ||
    calibration.profile !== "default" ||
    typeof calibration.browserVersion !== "string" ||
    calibration.browserVersion.trim().length === 0 ||
    calibration.viewport?.width !== ROW_MODEL_GATE_CONTEXT.viewport.width ||
    calibration.viewport?.height !== ROW_MODEL_GATE_CONTEXT.viewport.height ||
    calibration.deviceScaleFactor !== ROW_MODEL_GATE_CONTEXT.deviceScaleFactor
  ) {
    throw new Error(
      "Frame calibration requires the default gate Chromium context.",
    );
  }
  for (const summary of summaries) {
    if (
      !Number.isFinite(Date.parse(summary.timestamp)) ||
      timestamp > Date.parse(summary.timestamp)
    ) {
      throw new Error("Frame calibration must precede every workload summary.");
    }
    for (const key of [
      "browserName",
      "browserVersion",
      "profile",
      "deviceScaleFactor",
    ]) {
      if (calibration[key] !== summary[key])
        throw new Error(`Frame calibration ${key} differs from workload.`);
    }
    if (
      calibration.viewport.width !== summary.viewport?.width ||
      calibration.viewport.height !== summary.viewport?.height
    ) {
      throw new Error("Frame calibration viewport differs from workload.");
    }
  }
  return cadence;
}

export async function collectFrameCadence() {
  // Pure validation consumers do not need Playwright or an installed browser.
  const { chromium } = await import("@playwright/test");
  const browser = await chromium.launch({
    headless: true,
    timeout: TIMEOUT_MS,
  });
  let timer;
  try {
    const measurement = async () => {
      const context = await browser.newContext(ROW_MODEL_GATE_CONTEXT);
      const page = await context.newPage();
      const intervalsMs = await page.evaluate(
        ({ sampleCount, warmupFrames }) =>
          new Promise((resolve) => {
            const samples = [];
            let previous;
            let frames = 0;
            function tick(now) {
              if (previous !== undefined && frames > warmupFrames)
                samples.push(now - previous);
              previous = now;
              frames += 1;
              if (samples.length === sampleCount) resolve(samples);
              else globalThis.requestAnimationFrame(tick);
            }
            globalThis.requestAnimationFrame(tick);
          }),
        { sampleCount: SAMPLE_COUNT, warmupFrames: WARMUP_FRAMES },
      );
      return {
        timestamp: new Date().toISOString(),
        browserName: "chromium",
        browserVersion: browser.version(),
        profile: "default",
        ...ROW_MODEL_GATE_CONTEXT,
        intervalsMs,
      };
    };
    return await Promise.race([
      measurement(),
      new Promise((_, reject) => {
        timer = setTimeout(
          () => reject(new Error("Frame calibration timed out.")),
          TIMEOUT_MS,
        );
      }),
    ]);
  } finally {
    clearTimeout(timer);
    await browser.close();
  }
}
