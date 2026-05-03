import type { Metadata } from "next";

import { NavBar } from "./components/NavBar";
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
        <NavBar mode="site" />
        {children}
      </body>
    </html>
  );
}
