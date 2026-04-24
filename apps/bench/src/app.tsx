import { Footer, Nav } from "@pretable/ui";

import { BenchApp } from "./bench-app";
import { detectBrowserVersion } from "./bench-runtime";

const APP_VERSION = import.meta.env.VITE_APP_VERSION as string;

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
          Hardcoded "green" for now — parity with apps/playground/src/app.tsx. */}
      <Footer version={APP_VERSION} ciStatus="green" />
    </>
  );
}
