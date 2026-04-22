import { Footer, Nav } from "@pretable/ui";

import { InspectionDemo } from "./inspection-demo";

const APP_VERSION = import.meta.env.VITE_APP_VERSION as string;

export function App() {
  return (
    <>
      <Nav active="playground" version={APP_VERSION} />
      <main>
        <InspectionDemo />
      </main>
      <Footer version={APP_VERSION} ciStatus="green" />
    </>
  );
}
