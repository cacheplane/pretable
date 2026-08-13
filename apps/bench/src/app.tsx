import { Footer } from "./components/Footer";
import { Nav } from "./components/Nav";

import { BenchApp } from "./bench-app";
import { detectBrowserVersion } from "./bench-runtime";
import { WindowedHarness } from "./windowed-harness";

const APP_VERSION = import.meta.env.VITE_APP_VERSION as string;

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
