"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowUpRight, TrendingUp, TrendingDown, Info, X } from "lucide-react";
import { fmtNumber } from "@/lib/formatters";

interface Props {
  weeklyReplies: number;
  prevWeeklyReplies: number;
  activeAccounts: number;
  target: number;
}

export function NsmHero({ weeklyReplies, prevWeeklyReplies, activeAccounts, target }: Props) {
  const [showFormula, setShowFormula] = useState(false);

  const perAccount = activeAccounts > 0 ? weeklyReplies / activeAccounts : 0;
  const prevPerAccount = activeAccounts > 0 ? prevWeeklyReplies / activeAccounts : 0;
  const delta = perAccount - prevPerAccount;
  const pct = prevPerAccount > 0 ? (delta / prevPerAccount) * 100 : 0;
  const reaching = target > 0 ? Math.min(100, (perAccount / target) * 100) : 0;
  const Trend = delta > 0 ? TrendingUp : delta < 0 ? TrendingDown : Info;
  const trendText =
    delta > 0
      ? `+${pct.toFixed(1)}%`
      : delta < 0
      ? `${pct.toFixed(1)}%`
      : prevPerAccount === 0
      ? "前週データなし"
      : "変化なし";

  return (
    <section
      aria-labelledby="nsm-title"
      className="relative overflow-hidden rounded-[var(--radius-2xl)] border border-[var(--color-brand-200)] bg-[linear-gradient(135deg,rgba(186,230,253,0.45)_0%,rgba(255,255,255,0.85)_45%,rgba(204,251,241,0.50)_100%)] p-7 lg:p-9"
    >
      <div
        aria-hidden
        className="absolute -top-20 -right-20 size-[420px] rounded-full bg-[radial-gradient(circle,rgba(45,212,191,0.35),transparent_70%)] blur-2xl"
      />
      <div
        aria-hidden
        className="absolute bottom-0 left-1/3 size-[260px] rounded-full bg-[radial-gradient(circle,rgba(125,211,252,0.45),transparent_65%)] blur-2xl"
      />

      <div className="relative flex flex-wrap items-end justify-between gap-6">
        <div className="min-w-0">
          <div className="inline-flex items-center gap-2 mb-3 text-[11px] font-medium tracking-[0.18em] uppercase text-[var(--color-brand-700)]">
            <span className="size-1.5 rounded-full bg-[var(--color-brand-500)] pulse-soft" aria-hidden />
            North Star Metric · 直近 7 日
          </div>
          <h2
            id="nsm-title"
            className="font-display text-[15px] font-medium text-ink-700 [color:var(--color-ink-700)] mb-2"
          >
            アカウント当たりの新規返信 / 週
          </h2>
          <div className="flex items-baseline gap-3">
            <span className="kpi-numeral text-[88px] lg:text-[112px]">{perAccount.toFixed(1)}</span>
            <span className="text-ink-500 [color:var(--color-ink-500)] text-sm tabular font-mono">
              / {target} 目標
            </span>
          </div>

          <div className="mt-2 flex items-center flex-wrap gap-x-3 gap-y-1 text-[13px]">
            <span
              className={`inline-flex items-center gap-1 font-medium tabular font-mono ${
                delta > 0
                  ? "text-[var(--color-success-700)]"
                  : delta < 0
                  ? "text-[var(--color-danger-700)]"
                  : "text-ink-500 [color:var(--color-ink-500)]"
              }`}
            >
              <Trend className="size-4" aria-hidden />
              {trendText}
            </span>
            <span className="text-ink-500 [color:var(--color-ink-500)]">
              全アカウント計 {fmtNumber(weeklyReplies)} 件 · アクティブ{" "}
              <span className="tabular font-mono">{activeAccounts}</span> アカウント
            </span>
            <button
              type="button"
              onClick={() => setShowFormula((v) => !v)}
              aria-expanded={showFormula}
              aria-controls="nsm-formula"
              className="inline-flex items-center gap-1 text-ink-500 [color:var(--color-ink-500)] hover:text-ink-900 [&:hover]:[color:var(--color-ink-900)] underline-offset-4 hover:underline"
            >
              <Info className="size-3" aria-hidden />
              計算式
            </button>
          </div>

          {showFormula && (
            <div
              id="nsm-formula"
              role="region"
              className="mt-3 max-w-[480px] text-[12px] rounded-xl border border-[var(--color-brand-200)] bg-white/85 px-3 py-2.5 backdrop-blur-sm"
            >
              <div className="flex items-start justify-between gap-2 mb-1.5">
                <span className="text-[10px] font-bold tracking-[0.18em] uppercase text-[var(--color-brand-700)]">
                  Definition
                </span>
                <button
                  type="button"
                  onClick={() => setShowFormula(false)}
                  aria-label="閉じる"
                  className="size-5 grid place-content-center rounded-md hover:bg-[var(--color-ink-100)]"
                >
                  <X className="size-3" aria-hidden />
                </button>
              </div>
              <code className="block font-mono tabular text-[var(--color-ink-800)]">
                NSM = REPLIED(直近7日) / 週内に1回以上送信したアカウント数
              </code>
              <div className="mt-1 text-ink-500 [color:var(--color-ink-500)]">
                目標: <span className="font-mono">{target}</span> · 計測単位: 件 / 週 · 更新:
                バッチ集計 06:00 JST
              </div>
            </div>
          )}
        </div>

        <div className="flex flex-col gap-3 min-w-[280px]">
          <div className="flex items-center justify-between text-[12px] text-ink-600 [color:var(--color-ink-600)]">
            <span>目標到達率</span>
            <span className="tabular font-mono">{reaching.toFixed(0)}%</span>
          </div>
          <div
            role="progressbar"
            aria-valuenow={Math.round(reaching)}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label="目標到達率"
            className="h-2 rounded-full bg-white/70 overflow-hidden border border-white"
          >
            <div
              className="h-full bg-[linear-gradient(90deg,#7DD3FC,#0EA5E9_60%,#14B8A6)]"
              style={{ width: `${reaching}%` }}
            />
          </div>
          <Link
            href="/campaigns"
            className="self-end inline-flex items-center gap-1 text-[12px] font-medium text-[var(--color-brand-700)] hover:text-[var(--color-brand-900)]"
          >
            キャンペーン別の内訳を見る <ArrowUpRight className="size-3.5" aria-hidden />
          </Link>
        </div>
      </div>
    </section>
  );
}
