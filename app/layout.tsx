import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "CACHE//STRATA — Distributed Cache Resilience Telemetry",
  description:
    "An interactive, real-time visualization of how an in-memory cache tier shields a persistent database during a high-traffic on-sale — modelling write-through / write-back / write-around policies, the M/M/1 queueing knee, cache-stampede protection, and oversell-safe atomic inventory while clearing a 19,000-ticket surge.",
  authors: [{ name: "Portfolio" }],
};

export const viewport: Viewport = {
  themeColor: "#000000",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full`}
    >
      <body className="min-h-full bg-bg text-ink antialiased">{children}</body>
    </html>
  );
}
