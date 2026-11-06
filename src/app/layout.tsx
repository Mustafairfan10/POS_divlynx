import type { Metadata, Viewport } from "next";
import { Archivo } from "next/font/google";
import { themeBootScript } from "@/client/theme";
import "./globals.css";

// One workhorse family, self-hosted at build time so the type works offline too.
// The width axis gives condensed caps (column heads, serials) without a second face.
const body = Archivo({ variable: "--font-body", subsets: ["latin"], axes: ["wdth"] });

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
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#1e4a32" },
    { media: "(prefers-color-scheme: dark)", color: "#0a100d" },
  ],
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${body.variable} antialiased`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeBootScript }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
