import type { Metadata, Viewport } from "next";
import { Figtree, JetBrains_Mono, Unbounded } from "next/font/google";
import { themeBootScript } from "@/client/theme";
import "./globals.css";

// Self-hosted at build time, so the type works offline too.
const body = Figtree({ variable: "--font-body", subsets: ["latin"] });
const display = Unbounded({ variable: "--font-disp", subsets: ["latin"], weight: ["500", "600", "700"] });
const mono = JetBrains_Mono({ variable: "--font-code", subsets: ["latin"], weight: ["500", "700"] });

export const metadata: Metadata = {
  title: "Cafe POS",
  description: "Offline-first point of sale for restaurants and cafes",
  applicationName: "Cafe POS",
  appleWebApp: { capable: true, title: "Cafe POS", statusBarStyle: "default" },
  icons: { icon: "/icon.svg", apple: "/icon.svg" },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: "cover",
  themeColor: "#15100c",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${body.variable} ${display.variable} ${mono.variable} antialiased`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeBootScript }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
