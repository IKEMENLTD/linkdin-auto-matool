import type { NextConfig } from "next";

const isDev = process.env.NODE_ENV === "development";

/**
 * セキュリティヘッダ (UI/UX 設計書 §17 / §26)。
 * CSP は Phase2 で nonce ベースに移行する。MVP では unsafe-inline を許容しつつ
 * frame-ancestors 'none' / object-src 'none' で最低限の防御を敷く。
 */
const SECURITY_HEADERS = [
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "X-DNS-Prefetch-Control", value: "off" },
  {
    key: "Strict-Transport-Security",
    value: "max-age=63072000; includeSubDomains; preload",
  },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(), interest-cohort=()",
  },
  {
    /**
     * CSP — Phase1 (現状) は inline script を許容するため
     * `Report-Only` で出して違反を観測しつつ運用する。
     * Phase2 で nonce 化 (`'unsafe-inline'` を撤去) → enforcing に切替。
     */
    key: isDev ? "Content-Security-Policy-Report-Only" : "Content-Security-Policy-Report-Only",
    value: [
      "default-src 'self'",
      "img-src 'self' data: https: blob:",
      `script-src 'self' ${isDev ? "'unsafe-eval' 'unsafe-inline'" : "'unsafe-inline'"}`,
      "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
      "font-src 'self' https://fonts.gstatic.com data:",
      "connect-src 'self' https://*.supabase.co https://*.supabase.in wss://*.supabase.co",
      "frame-ancestors 'none'",
      "base-uri 'self'",
      "form-action 'self'",
      "object-src 'none'",
      // upgrade-insecure-requests は Report-Only モードでは無視されるため一旦除外。
      // Phase2 で Enforce モードに切替えるタイミングで再導入する。
      "report-uri /api/csp-report",
    ].join("; "),
  },
];

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  experimental: {
    typedRoutes: false,
  },
  images: {
    formats: ["image/avif", "image/webp"],
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: SECURITY_HEADERS,
      },
    ];
  },
};

export default nextConfig;
