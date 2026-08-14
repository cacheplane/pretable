import { ServerQueryGrid } from "./ServerQueryGrid";

/**
 * Kept to a heading and the grid so the header row sits above the fold. The
 * filter popover closes on any scroll (`overlay/useHeaderPopover.ts`), and
 * Playwright auto-scrolls a target into view before clicking it, so a funnel
 * below the fold opens and shuts in the same frame.
 */
export default function ServerQueryFixturePage() {
  return (
    <main style={{ padding: 24 }}>
      <h1 style={{ marginBottom: 12 }}>Server query fixture</h1>
      <ServerQueryGrid />
    </main>
  );
}
