import { CodeExample } from "./components/CodeExample";
import { ComparisonTable } from "./components/ComparisonTable";
import { CtaSection } from "./components/CtaSection";
import { DrawerHandle } from "./components/DrawerHandle";
import { DrawerNavSlot } from "./components/DrawerNavSlot";
import { DrawerShell } from "./components/DrawerShell";
import { FeatureGrid } from "./components/FeatureGrid";
import { HeroGrid } from "./components/HeroGrid";
import { ControlStateProvider } from "./components/heroGrid/controlState";
import { HomeStreamHeader } from "./components/HomeStreamHeader";
import { HowItWorks } from "./components/HowItWorks";
import { MountainFooter } from "./components/MountainFooter";
import { ReceiptsBand } from "./components/ReceiptsBand";
import { ScrollReveal } from "./components/ScrollReveal";

export default function HomePage() {
  return (
    <ControlStateProvider>
      <main>
        <HomeStreamHeader />
        <HeroGrid />
      </main>
      <DrawerHandle />
      <DrawerShell>
        <DrawerNavSlot />
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
        <MountainFooter />
      </DrawerShell>
    </ControlStateProvider>
  );
}
