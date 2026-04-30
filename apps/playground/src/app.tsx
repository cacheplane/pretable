import { Footer, Nav } from "@pretable/ui";

import { PitchGrid } from "./pitch-grid";
import { PitchHero } from "./pitch-hero";
import { ReceiptsBand } from "./receipts-band";
import { StreamingProof } from "./streaming-proof";

const APP_VERSION = import.meta.env.VITE_APP_VERSION as string;

export function App() {
  return (
    <>
      {/* Phase 1 transitional: "playground" is no longer in @pretable/ui's
          Nav LINKS array (the home tab is "website" now). active="playground"
          still typechecks but renders no active highlight. Phase 3 retires
          this app — see docs/superpowers/plans/2026-04-24-website-phase-1.md */}
      <Nav active="playground" version={APP_VERSION} />
      <main>
        <PitchHero />
        <PitchGrid />
        <StreamingProof />
        <ReceiptsBand />
      </main>
      {/* TODO(direction-D): wire ciStatus to a real source (status/runsets/*.json
          or a build-time env var). Hardcoded "green" for the A ship. */}
      <Footer version={APP_VERSION} ciStatus="green" />
    </>
  );
}
