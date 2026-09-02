import { CodeExample } from "./components/CodeExample";
import { ColumnLayoutShowcase } from "./components/ColumnLayoutShowcase";
import { ComparisonTable } from "./components/ComparisonTable";
import { CtaSection } from "./components/CtaSection";
import { DrawerHandle } from "./components/DrawerHandle";
import { DrawerHero } from "./components/DrawerHero";
import { DrawerNavSlot } from "./components/DrawerNavSlot";
import { DrawerShell } from "./components/DrawerShell";
import { FeatureGrid } from "./components/FeatureGrid";
import { HeroGrid } from "./components/HeroGrid";
import { ControlStateProvider } from "./components/heroGrid/controlState";
import { HomeStreamHeader } from "./components/HomeStreamHeader";
import { HowItWorks } from "./components/HowItWorks";
import { MountainFooter } from "./components/MountainFooter";
import { ReceiptsBand } from "./components/ReceiptsBand";
import { RejectedWritesShowcase } from "./components/RejectedWritesShowcase";
import { ScaleShowcase } from "./components/ScaleShowcase";
import { ScrollReveal } from "./components/ScrollReveal";
import { StreamingByDesign } from "./components/StreamingByDesign";
import { JsonLd } from "../lib/seo/JsonLd";
import { buildPageSchema, HOME_PAGE_DESCRIPTOR } from "../lib/seo/page";

export default function HomePage() {
  return (
    <ControlStateProvider>
      <JsonLd data={buildPageSchema(HOME_PAGE_DESCRIPTOR)} />
      <main>
        <HomeStreamHeader />
        <HeroGrid />
      </main>
      <DrawerHandle />
      <DrawerShell>
        <DrawerNavSlot />
        <DrawerHero />
        <HowItWorks />
        <ReceiptsBand />
        <ScrollReveal>
          <ComparisonTable />
        </ScrollReveal>
        <ScrollReveal>
          <StreamingByDesign />
        </ScrollReveal>
        <ScrollReveal>
          <CodeExample />
        </ScrollReveal>
        <ScrollReveal>
          <FeatureGrid />
        </ScrollReveal>
        <ScrollReveal>
          <ScaleShowcase />
        </ScrollReveal>
        <ScrollReveal>
          <ColumnLayoutShowcase />
        </ScrollReveal>
        <ScrollReveal>
          <RejectedWritesShowcase />
        </ScrollReveal>
        <ScrollReveal>
          <CtaSection />
        </ScrollReveal>
        <MountainFooter />
      </DrawerShell>
    </ControlStateProvider>
  );
}
