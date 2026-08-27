#!/usr/bin/env node

import { mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { chromium } from "@playwright/test";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUTPUT_DIRECTORY = path.join(ROOT, "apps/website/public/og");
const OUTPUT_PATH = path.join(OUTPUT_DIRECTORY, "pretable.png");
const WIDTH = 1200;
const HEIGHT = 630;

const html = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <style>
      * { box-sizing: border-box; }

      html, body {
        width: ${WIDTH}px;
        height: ${HEIGHT}px;
        margin: 0;
        overflow: hidden;
        background: #0b1120;
      }

      body {
        color: #e2e8f0;
        font-family: Georgia, "Times New Roman", serif;
        -webkit-font-smoothing: antialiased;
      }

      .card {
        position: relative;
        width: 100%;
        height: 100%;
        overflow: hidden;
        padding: 56px 64px;
        background:
          radial-gradient(circle at 83% 11%, rgba(56, 189, 248, 0.16), transparent 24%),
          linear-gradient(135deg, #0f172a 0%, #0b1120 65%);
      }

      .card::before {
        position: absolute;
        inset: 24px;
        border: 1px solid #1e293b;
        content: "";
        pointer-events: none;
      }

      .eyebrow {
        display: flex;
        align-items: center;
        gap: 11px;
        margin: 0 0 62px;
        color: #94a3b8;
        font-family: "JetBrains Mono", "SFMono-Regular", Menlo, monospace;
        font-size: 18px;
        letter-spacing: 0.02em;
      }

      .eyebrow-dot {
        width: 11px;
        height: 11px;
        border-radius: 50%;
        background: #38bdf8;
        box-shadow: 0 0 0 6px rgba(56, 189, 248, 0.12);
      }

      h1 {
        max-width: 730px;
        margin: 0;
        color: #e2e8f0;
        font-size: 57px;
        font-weight: 500;
        letter-spacing: -0.045em;
        line-height: 1.05;
      }

      .url {
        position: absolute;
        bottom: 61px;
        left: 64px;
        margin: 0;
        color: #38bdf8;
        font-family: "JetBrains Mono", "SFMono-Regular", Menlo, monospace;
        font-size: 19px;
        letter-spacing: 0.01em;
      }

      .mark {
        position: absolute;
        right: 62px;
        bottom: 51px;
        width: 354px;
        height: 320px;
      }

      @media (prefers-reduced-motion: reduce) {
        *, *::before, *::after {
          animation-duration: 0.01ms !important;
          animation-iteration-count: 1 !important;
          scroll-behavior: auto !important;
          transition-duration: 0.01ms !important;
        }
      }
    </style>
  </head>
  <body>
    <main class="card">
      <p class="eyebrow"><span class="eyebrow-dot"></span>Pretable</p>
      <h1>The grid that treats scroll as a first-class feature.</h1>
      <p class="url">https://pretable.ai</p>
      <svg class="mark" viewBox="0 0 354 320" aria-hidden="true">
        <defs>
          <linearGradient id="stream" x1="0" x2="1" y1="0" y2="0">
            <stop offset="0" stop-color="#0284c7" />
            <stop offset="1" stop-color="#38bdf8" />
          </linearGradient>
        </defs>
        <rect x="1" y="1" width="352" height="318" rx="10" fill="#020617" stroke="#1e293b" />
        <path d="M1 65h352M1 128h352M1 191h352M1 254h352M89 1v318M177 1v318M265 1v318" fill="none" stroke="#131b2c" stroke-width="1" />
        <path d="M31 253C74 244 87 198 119 197S168 238 198 210S237 88 285 89S311 118 328 75" fill="none" stroke="url(#stream)" stroke-linecap="round" stroke-width="8" />
        <circle cx="31" cy="253" r="8" fill="#0f172a" stroke="#38bdf8" stroke-width="4" />
        <circle cx="119" cy="197" r="8" fill="#0f172a" stroke="#38bdf8" stroke-width="4" />
        <circle cx="198" cy="210" r="8" fill="#0f172a" stroke="#38bdf8" stroke-width="4" />
        <circle cx="285" cy="89" r="8" fill="#0f172a" stroke="#38bdf8" stroke-width="4" />
        <circle cx="328" cy="75" r="8" fill="#38bdf8" />
      </svg>
    </main>
  </body>
</html>`;

await mkdir(OUTPUT_DIRECTORY, { recursive: true });

const browser = await chromium.launch();
try {
  const page = await browser.newPage({
    deviceScaleFactor: 1,
    viewport: { width: WIDTH, height: HEIGHT },
  });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.setContent(html, { waitUntil: "load" });
  await page.screenshot({ animations: "disabled", path: OUTPUT_PATH });
} finally {
  await browser.close();
}
