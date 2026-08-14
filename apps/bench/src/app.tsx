import { Footer } from "./components/Footer";
import { Nav } from "./components/Nav";

import { BenchApp } from "./bench-app";
import { detectBrowserVersion } from "./bench-runtime";
import { WindowedHarness } from "./windowed-harness";

const APP_VERSION = import.meta.env.VITE_APP_VERSION as string;
/**
 * Which build this page IS, so a run can prove it measured the build it meant
 * to. Written on `<html>` rather than inside the app so it survives whatever
 * the adapter is doing, and so a check can read it before any grid mounts.
 * Undefined under `vite dev` and vitest, where nothing is being published.
 */
const BENCH_BUILD_ID = import.meta.env.VITE_BENCH_BUILD_ID as
  string | undefined;

if (typeof document !== "undefined" && BENCH_BUILD_ID) {
  document.documentElement.dataset.benchBuildId = BENCH_BUILD_ID;
}

export function App() {
  const search = window.location.search;

  // `?windowed=1` bypasses the whole scripted P0a measurement apparatus for a
  // minimal, telemetry-free harness — see windowed-harness.tsx for why.
  if (new URLSearchParams(search).get("windowed") === "1") {
    return <WindowedHarness search={search} />;
  }

  return (
    <>
      <Nav active="bench" version={APP_VERSION} />
      <main>
        <BenchApp
          search={search}
          browserVersion={detectBrowserVersion(window.navigator.userAgent)}
        />
      </main>
      {/* TODO(ci-signal): wire ciStatus to a real source once CI status plumbing exists.
          Hardcoded "green" for now. */}
      <Footer version={APP_VERSION} ciStatus="green" />
    </>
  );
}
