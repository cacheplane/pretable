import { Footer, Nav } from "@pretable/ui";
import type { Metadata, Viewport } from "next";

import "./globals.css";

const APP_VERSION = process.env.npm_package_version ?? "0.0.0";

export const metadata: Metadata = {
  title: "pretable",
  description: "The grid that treats scroll as a first-class feature.",
};

export const viewport: Viewport = {
  themeColor: "#0b1120",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>
        <Nav active="website" version={APP_VERSION} />
        <main>{children}</main>
        {/* TODO(ci-signal): wire ciStatus to a real source once CI status plumbing exists.
            Hardcoded "green" for now — parity with apps/playground/src/app.tsx. */}
        <Footer version={APP_VERSION} ciStatus="green" />
      </body>
    </html>
  );
}
