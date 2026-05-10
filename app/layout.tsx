import type { Metadata, Viewport } from "next";
import { Manrope, Geist, Geist_Mono, Noto_Sans_JP } from "next/font/google";
import "./globals.css";

const manrope = Manrope({
  subsets: ["latin"],
  variable: "--font-manrope",
  display: "swap",
});

const geist = Geist({
  subsets: ["latin"],
  variable: "--font-geist",
  display: "swap",
});

const geistMono = Geist_Mono({
  subsets: ["latin"],
  variable: "--font-geist-mono",
  display: "swap",
});

const notoJP = Noto_Sans_JP({
  subsets: ["latin"],
  weight: ["400", "500", "700"],
  variable: "--font-noto-jp",
  display: "swap",
});

export const metadata: Metadata = {
  title: {
    default: "LinkdInside — AI 駆動のLinkedIn 自動営業",
    template: "%s · LinkdInside",
  },
  description:
    "日本語 B2B に最適化された、レビュー必須・安全モード搭載の LinkedIn 自動営業 SaaS。",
  applicationName: "LinkdInside",
  authors: [{ name: "IKEMENLTD" }],
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#FFFFFF" },
    { media: "(prefers-color-scheme: dark)", color: "#0B1220" },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="ja"
      className={`${manrope.variable} ${geist.variable} ${geistMono.variable} ${notoJP.variable}`}
    >
      <body className="min-h-screen antialiased">{children}</body>
    </html>
  );
}
