import type { Metadata, Viewport } from "next";
import "./globals.css";

// 注: dev 環境で Google Fonts のフェッチに失敗する場合は、
// system font fallback で動作させる。本番ビルド時に next/font/google に戻すこと。
// 元の実装は app/layout.tsx.fonts.bak (本コミットでは省略)。

/** ブランド水色グラデの favicon (外部 fetch なしで inline data URI 化) */
const FAVICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><defs><linearGradient id="g" x1="0" y1="0" x2="32" y2="32" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="%237DD3FC"/><stop offset="0.5" stop-color="%230EA5E9"/><stop offset="1" stop-color="%230D9488"/></linearGradient></defs><rect x="2" y="2" width="28" height="28" rx="8" fill="url(%23g)"/><path d="M11 11.5v9M16 14.5v6M21 14.5c-2.2 0-3 1.5-3 3v3M21 14.5v6" stroke="white" stroke-width="1.8" stroke-linecap="round" fill="none"/><circle cx="11" cy="9.2" r="1.4" fill="white"/></svg>`;

export const metadata: Metadata = {
  title: {
    default: "LinkdInside — AI 駆動のLinkedIn 自動営業",
    template: "%s · LinkdInside",
  },
  description:
    "日本語 B2B に最適化された、レビュー必須・安全モード搭載の LinkedIn 自動営業 SaaS。",
  applicationName: "LinkdInside",
  authors: [{ name: "IKEMENLTD" }],
  icons: {
    icon: [
      {
        url: `data:image/svg+xml;charset=utf-8,${FAVICON_SVG}`,
        type: "image/svg+xml",
      },
    ],
  },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#FFFFFF" },
    { media: "(prefers-color-scheme: dark)", color: "#0B1220" },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ja">
      <body className="min-h-screen antialiased">{children}</body>
    </html>
  );
}
