import { RouteAwareNav } from "./components/RouteAwareNav";
import type { Metadata } from "next";

import "./globals.css";

export const metadata: Metadata = {
  title: "pretable",
  description: "The grid that treats scroll as a first-class feature.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>
        <RouteAwareNav />
        {children}
      </body>
    </html>
  );
}
