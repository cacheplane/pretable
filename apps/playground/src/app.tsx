import { Footer, Nav } from "@pretable/ui";

import { PitchGrid } from "./pitch-grid";
import { PitchHero } from "./pitch-hero";
import { ReceiptsBand } from "./receipts-band";

const APP_VERSION = import.meta.env.VITE_APP_VERSION as string;

export function App() {
  return (
    <>
      <Nav active="playground" version={APP_VERSION} />
      <main>
        <PitchHero />
        <PitchGrid />
        <ReceiptsBand />
      </main>
      <Footer version={APP_VERSION} ciStatus="green" />
    </>
  );
}
