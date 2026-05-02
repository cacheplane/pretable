import { CodeExample } from "./components/CodeExample";
import { ComparisonTable } from "./components/ComparisonTable";
import { CtaSection } from "./components/CtaSection";
import { Drawer } from "./components/Drawer";
import { FeatureGrid } from "./components/FeatureGrid";
import { HeroGrid } from "./components/HeroGrid";
import { HowItWorks } from "./components/HowItWorks";
import { MountainFooter } from "./components/MountainFooter";
import { ReceiptsBand } from "./components/ReceiptsBand";
import { ScrollReveal } from "./components/ScrollReveal";

export default function HomePage() {
  return (
    <>
      <main>
        <HeroGrid />
        <Drawer>
          <ReceiptsBand />
          <ScrollReveal>
            <ComparisonTable />
          </ScrollReveal>
          <ScrollReveal>
            <HowItWorks />
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
        </Drawer>
      </main>
      <MountainFooter />
    </>
  );
}
