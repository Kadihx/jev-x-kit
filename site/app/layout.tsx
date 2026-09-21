import type { Metadata } from "next";
import { Space_Grotesk, JetBrains_Mono } from "next/font/google";
import "./globals.css";

const display = Space_Grotesk({
  subsets: ["latin"],
  weight: ["500", "700"],
  variable: "--font-display",
});

const mono = JetBrains_Mono({
  subsets: ["latin"],
  weight: ["400", "500", "700"],
  variable: "--font-mono",
});

export const metadata: Metadata = {
  metadataBase: new URL("https://jev-x-kit.vercel.app"),
  title: "jev-x-kit — a $0 decision layer for coding agents",
  description:
    "Non-autoregressive Choice/Score/Noul primitives, a BELKİ confidence gatekeeper, ultra-planning, red-teaming, 4-channel research and RLVR self-improvement — as an MCP server + CLI + Claude Code skill. Runs offline, no GPU, no API key.",
  openGraph: {
    title: "jev-x-kit — a $0 decision layer for coding agents",
    description:
      "Stop paying frontier prices for yes/no. Non-autoregressive decision primitives for Claude Code, Cursor, Codex and every MCP-compatible agent.",
    url: "https://jev-x-kit.vercel.app",
    siteName: "jev-x-kit",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "jev-x-kit — a $0 decision layer for coding agents",
    description:
      "Stop paying frontier prices for yes/no. Non-autoregressive decision primitives for Claude Code, Cursor, Codex and every MCP-compatible agent.",
  },
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`${display.variable} ${mono.variable}`}>
      <body className="font-mono antialiased">{children}</body>
    </html>
  );
}
