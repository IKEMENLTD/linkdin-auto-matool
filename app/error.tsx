"use client";

import { useEffect } from "react";
import { AlertOctagon, RefreshCw, Copy } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function ErrorBoundary({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // 本番では Sentry / OpenTelemetry に送信する。
    // 設計書 §12.3.1: incident_id / correlation_id をユーザーに提示。
    if (typeof window !== "undefined") {
      console.error("[Error Boundary]", error);
    }
  }, [error]);

  // server で発番された digest を最優先 (ログとの突合のため)。
  // クライアント側 fallback は識別子空間を 24bit に拡げた hex で衝突確率を下げる。
  const fallback = (() => {
    const buf = new Uint8Array(3);
    if (typeof crypto !== "undefined" && "getRandomValues" in crypto) {
      crypto.getRandomValues(buf);
    } else {
      for (let i = 0; i < buf.length; i++) buf[i] = Math.floor(Math.random() * 256);
    }
    const hex = Array.from(buf)
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("")
      .toUpperCase();
    return `INC-${new Date().getUTCFullYear()}-${hex}`;
  })();
  const incident = error.digest ?? fallback;

  return (
    <div className="hydro-canvas min-h-screen flex items-center justify-center px-6">
      <div className="max-w-[480px] w-full text-center">
        <div className="inline-flex items-center justify-center size-14 rounded-2xl border border-[#FECACA] bg-[var(--color-danger-50)] text-[var(--color-danger-700)] mb-5">
          <AlertOctagon className="size-7" aria-hidden />
        </div>
        <h1 className="font-display text-[28px] font-bold tracking-tight text-ink-900 [color:var(--color-ink-900)] mb-2">
          処理中に問題が発生しました
        </h1>
        <p className="text-[14px] text-ink-600 [color:var(--color-ink-600)] mb-5 leading-relaxed">
          一時的な問題の可能性があります。再試行いただくか、解決しない場合は下のインシデント番号と一緒にサポートへご連絡ください。
        </p>

        <div className="flex items-center justify-center gap-2 mb-6 text-[12px] tabular font-mono text-ink-500 [color:var(--color-ink-500)]">
          <span>インシデント番号:</span>
          <code className="px-2 py-1 rounded-md border border-[var(--color-ink-200)] bg-white">{incident}</code>
          <button
            type="button"
            aria-label="インシデント番号をコピー"
            onClick={() => navigator.clipboard?.writeText(incident)}
            className="size-7 grid place-content-center rounded-md border border-[var(--color-ink-200)] bg-white hover:border-[var(--color-brand-300)]"
          >
            <Copy className="size-3.5" aria-hidden />
          </button>
        </div>

        <div className="flex items-center justify-center gap-2">
          <Button onClick={reset} variant="primary">
            <RefreshCw className="size-4" aria-hidden />
            再試行する
          </Button>
          <Button variant="secondary" onClick={() => (window.location.href = "/dashboard")}>
            ダッシュボードへ戻る
          </Button>
        </div>
      </div>
    </div>
  );
}
