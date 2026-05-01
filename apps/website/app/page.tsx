import { CodeExample } from "./components/CodeExample";
import { ComparisonTable } from "./components/ComparisonTable";
import { CtaSection } from "./components/CtaSection";
import { FeatureGrid } from "./components/FeatureGrid";
import { Hero } from "./components/Hero";
import { PlaygroundSection } from "./components/PlaygroundSection";
import { Problem } from "./components/Problem";
import { ReceiptsBand } from "./components/ReceiptsBand";
import { Solution } from "./components/Solution";

export default function HomePage() {
  return (
    <>
      <Hero />
      <PlaygroundSection />
      <Problem />
      <Solution />
      <ReceiptsBand />
      <ComparisonTable />
      <FeatureGrid />
      <CodeExample />
      <CtaSection />
    </>
  );
}
