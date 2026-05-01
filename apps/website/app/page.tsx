import { CodeExample } from "./components/CodeExample";
import { ComparisonTable } from "./components/ComparisonTable";
import { CtaSection } from "./components/CtaSection";
import { FeatureGrid } from "./components/FeatureGrid";
import { Hero } from "./components/Hero";
import { PlaygroundSection } from "./components/PlaygroundSection";
import { PositioningStrip } from "./components/PositioningStrip";
import { Problem } from "./components/Problem";
import { ReceiptsBand } from "./components/ReceiptsBand";
import { ScrollReveal } from "./components/ScrollReveal";
import { TrustStrip } from "./components/TrustStrip";
import { UseCases } from "./components/UseCases";

export default function HomePage() {
  return (
    <>
      <Hero />
      <ScrollReveal>
        <PositioningStrip />
      </ScrollReveal>
      <PlaygroundSection />
      <ScrollReveal>
        <Problem />
      </ScrollReveal>
      <ScrollReveal>
        <UseCases />
      </ScrollReveal>
      <ScrollReveal>
        <TrustStrip />
      </ScrollReveal>
      <ScrollReveal>
        <ReceiptsBand />
      </ScrollReveal>
      <ScrollReveal>
        <ComparisonTable />
      </ScrollReveal>
      <ScrollReveal>
        <CodeExample />
      </ScrollReveal>
      <ScrollReveal>
        <FeatureGrid />
      </ScrollReveal>
      <ScrollReveal>
        <CtaSection />
      </ScrollReveal>
    </>
  );
}
