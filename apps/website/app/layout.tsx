import type { Metadata } from "next";

import { JsonLd } from "../lib/seo/JsonLd";
import {
  buildSiteSchema,
  HOME_PAGE_DESCRIPTOR,
  resolvePageMetadata,
  SITE_ORIGIN,
} from "../lib/seo/page";

import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_ORIGIN),
  ...resolvePageMetadata(HOME_PAGE_DESCRIPTOR),
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html data-drawer="closed" lang="en">
      <body>
        <JsonLd data={buildSiteSchema()} />
        {children}
      </body>
    </html>
  );
}
