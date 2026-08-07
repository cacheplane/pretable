import type { Metadata } from "next";

/**
 * Routes under `/fixtures` exist for the Playwright suite, not for readers.
 * They ship in the production build because the smoke suite runs against the
 * deployed site — so keep them out of search results rather than out of the
 * bundle.
 */
export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

export default function FixturesLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
