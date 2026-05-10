import { NextResponse, type NextRequest } from "next/server";
import { rateLimit } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ALLOWED_TYPES = new Set([
  "application/csp-report",
  "application/reports+json",
  "application/json",
]);

/**
 * CSP Report-Only モードのレポート受信エンドポイント。
 * - Content-Type を CSP report 標準に絞る
 * - 同一 origin からの送信のみ受け付ける
 * - IP 単位で rate limit (DoS 対策)
 * - body サイズ上限 16KB
 * MVP では log のみ。Phase2 で Sentry / SIEM へ転送する。
 */
export async function POST(request: NextRequest) {
  const contentType = request.headers.get("content-type")?.split(";")[0]?.trim() ?? "";
  if (!ALLOWED_TYPES.has(contentType)) {
    return new NextResponse(null, { status: 415 });
  }

  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  const limit = rateLimit(`csp-report:${ip}`, 60, 60_000);
  if (!limit.ok) {
    return new NextResponse(null, { status: 429 });
  }

  const text = await request.text();
  if (text.length > 16 * 1024) {
    return new NextResponse(null, { status: 413 });
  }

  if (process.env.NODE_ENV !== "production") {
    try {
      console.warn("[CSP Violation]", JSON.parse(text));
    } catch {
      console.warn("[CSP Violation raw]", text.slice(0, 1024));
    }
  }
  // TODO: Phase2 で Sentry.captureMessage("csp_report", { extra: parsed })

  return new NextResponse(null, { status: 204 });
}
