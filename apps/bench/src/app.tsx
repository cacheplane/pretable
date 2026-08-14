import { Footer } from "./components/Footer";
import { Nav } from "./components/Nav";

import { BenchApp } from "./bench-app";
import { detectBrowserVersion } from "./bench-runtime";

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
  return (
    <>
      <Nav active="bench" version={APP_VERSION} />
      <main>
        <BenchApp
          search={window.location.search}
          browserVersion={detectBrowserVersion(window.navigator.userAgent)}
        />
      </main>
      {/* TODO(ci-signal): wire ciStatus to a real source once CI status plumbing exists.
          Hardcoded "green" for now. */}
      <Footer version={APP_VERSION} ciStatus="green" />
    </>
  );
}
