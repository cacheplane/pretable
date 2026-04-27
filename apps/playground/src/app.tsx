import { Footer, Nav } from "@pretable/ui";

import { PitchGrid } from "./pitch-grid";
import { PitchHero } from "./pitch-hero";
import { ReceiptsBand } from "./receipts-band";
import { StreamingProof } from "./streaming-proof";

const APP_VERSION = import.meta.env.VITE_APP_VERSION as string;

export function App() {
  return (
    <>
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
