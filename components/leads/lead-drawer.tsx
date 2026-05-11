"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import {
  X,
  ExternalLink,
  Building2,
  Briefcase,
  Calendar,
  Target,
} from "lucide-react";
import { StateChip } from "@/components/ui/state-chip";
import { fmtRelative } from "@/lib/formatters";
import type { LeadListItem } from "@/server/queries/leads";
import { cn } from "@/lib/utils";

interface Props {
  lead: LeadListItem | null;
  open: boolean;
}

export function LeadDrawer({ lead, open }: Props) {
  const router = useRouter();
  const sp = useSearchParams();
  const dialogRef = React.useRef<HTMLElement | null>(null);
  const previousFocusRef = React.useRef<HTMLElement | null>(null);

  const close = React.useCallback(() => {
    const params = new URLSearchParams(sp.toString());
    params.delete("lead");
    router.push(params.size ? `/leads?${params.toString()}` : "/leads", { scroll: false });
  }, [sp, router]);

  // Escape
  React.useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && close();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, close]);

  // body スクロール
  React.useEffect(() => {
    if (!open) return;
    const orig = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = orig;
    };
  }, [open]);

  // 初期フォーカス + 戻り先フォーカス
  React.useEffect(() => {
    if (!open) return;
    previousFocusRef.current = (document.activeElement as HTMLElement) ?? null;
    const dialog = dialogRef.current;
    const focusable = dialog?.querySelector<HTMLElement>(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
    );
    focusable?.focus();
    return () => {
      previousFocusRef.current?.focus?.();
    };
  }, [open]);

  // Tab トラップ
  const handleKeyDown = React.useCallback((e: React.KeyboardEvent<HTMLElement>) => {
    if (e.key !== "Tab") return;
    const dialog = dialogRef.current;
    if (!dialog) return;
    const focusables = dialog.querySelectorAll<HTMLElement>(
      'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
    );
    if (focusables.length === 0) return;
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    const active = document.activeElement as HTMLElement | null;
    if (e.shiftKey && active === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && active === last) {
      e.preventDefault();
      first.focus();
    }
  }, []);

  return (
    <div
      className={cn(
        "fixed inset-0 z-50 transition-opacity",
        open ? "opacity-100 pointer-events-auto" : "opacity-0 pointer-events-none"
      )}
      aria-hidden={!open}
    >
      <button
        type="button"
        tabIndex={-1}
        aria-label="ドロワーを閉じる"
        onClick={close}
        className="absolute inset-0 bg-[rgba(11,30,63,0.45)] backdrop-blur-sm"
      />
      <aside
        ref={(el) => {
          dialogRef.current = el;
        }}
        role="dialog"
        aria-modal="true"
        aria-labelledby="lead-drawer-title"
        onKeyDown={handleKeyDown}
        className={cn(
          "absolute inset-y-0 right-0 w-full sm:w-[480px] bg-white shadow-[0_30px_70px_-20px_rgba(11,30,63,0.4)] flex flex-col transition-transform duration-200 ease-[var(--ease-glide)] overflow-y-auto",
          open ? "translate-x-0" : "translate-x-full"
        )}
      >
        <header className="sticky top-0 z-10 bg-white/95 backdrop-blur-md border-b border-[var(--color-ink-100)] px-5 py-4 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="text-[10px] font-bold tracking-[0.18em] uppercase text-[var(--color-brand-700)] mb-1">
              Lead
            </div>
            <h2
              id="lead-drawer-title"
              className="font-display text-[20px] font-bold tracking-tight text-ink-900 [color:var(--color-ink-900)] truncate"
            >
              {lead?.name ?? "リードが見つかりません"}
            </h2>
          </div>
          <button
            type="button"
            onClick={close}
            aria-label="閉じる"
            className="size-9 grid place-content-center rounded-full border border-[var(--color-ink-200)] bg-white hover:border-[var(--color-brand-300)] shrink-0"
          >
            <X className="size-4" aria-hidden />
          </button>
        </header>

        {lead ? (
          <div className="flex-1 p-5 space-y-6">
            <div className="flex items-center flex-wrap gap-2">
              <StateChip state={lead.state} size="md" />
            </div>

            <section aria-labelledby="lead-info">
              <h3 id="lead-info" className="sr-only">
                プロフィール
              </h3>
              <div className="grid grid-cols-1 gap-3 text-[13px]">
                <Row icon={Briefcase} label="役職">
                  {lead.headline ?? <Muted>未取得</Muted>}
                </Row>
                <Row icon={Building2} label="会社">
                  {lead.company ?? <Muted>未取得</Muted>}
                </Row>
                <Row icon={Target} label="キャンペーン">
                  {lead.campaignName ? (
                    <Link
                      href={`/campaigns/${lead.campaignId}`}
                      className="text-[var(--color-brand-700)] hover:underline inline-flex items-center gap-1"
                    >
                      {lead.campaignName}
                      <ExternalLink className="size-3" aria-hidden />
                    </Link>
                  ) : (
                    <Muted>—</Muted>
                  )}
                </Row>
                <Row icon={Calendar} label="最終アクション">
                  {lead.lastActionAt ? (
                    <span className="tabular font-mono">{fmtRelative(lead.lastActionAt)}</span>
                  ) : (
                    <Muted>未開始</Muted>
                  )}
                </Row>
              </div>
            </section>

            <section aria-labelledby="score-breakdown">
              <h3
                id="score-breakdown"
                className="text-[11px] font-bold tracking-[0.18em] uppercase text-ink-500 [color:var(--color-ink-500)] mb-3"
              >
                スコア
              </h3>
              <div className="rounded-2xl border border-[var(--color-ink-100)] bg-[var(--color-ink-50)]/40 p-4">
                <div className="flex items-baseline justify-between mb-2">
                  <span className="text-[12px] text-ink-500 [color:var(--color-ink-500)]">AI 適合度</span>
                  <span className="font-display text-[28px] font-bold tabular tracking-tight text-[var(--color-brand-700)]">
                    {lead.score}
                  </span>
                </div>
                <div
                  role="progressbar"
                  aria-valuenow={lead.score}
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-label="AI 適合スコア"
                  className="h-1.5 rounded-full bg-white overflow-hidden border border-[var(--color-ink-100)]"
                >
                  <div
                    className="h-full bg-[linear-gradient(90deg,#38BDF8,#0EA5E9,#14B8A6)]"
                    style={{ width: `${Math.max(0, Math.min(100, lead.score))}%` }}
                  />
                </div>
                <div className="mt-3 text-[11px] text-ink-500 [color:var(--color-ink-500)] leading-relaxed">
                  内訳 (職種一致 / 会社規模 / シグナル / Engagement) の詳細表示は Phase2 で提供予定です。
                </div>
              </div>
            </section>

            <section
              aria-labelledby="next-steps"
              className="rounded-2xl border border-[var(--color-brand-200)] bg-[linear-gradient(180deg,rgba(240,249,255,0.5),white)] p-4"
            >
              <h3
                id="next-steps"
                className="text-[11px] font-bold tracking-[0.18em] uppercase text-[var(--color-brand-700)] mb-2"
              >
                次のアクション
              </h3>
              <ul className="space-y-2 text-[12px] text-ink-700 [color:var(--color-ink-700)]">
                {lead.state === "REPLIED" ? (
                  <li>受信箱で AI ドラフトをレビューして返信</li>
                ) : lead.state === "CONNECTED" ? (
                  <li>初回 DM の送信タイミングを確認</li>
                ) : lead.state === "MEETING" ? (
                  <li>CRM に Deal を作成して進捗を記録</li>
                ) : (
                  <li>キャンペーン進行中。状態遷移を待機</li>
                )}
                <li>会話履歴 / タイムライン (Phase2)</li>
              </ul>
            </section>
          </div>
        ) : (
          <div className="flex-1 grid place-content-center text-[13px] text-ink-500 [color:var(--color-ink-500)] p-8 text-center">
            URL の lead パラメータに該当するリードが見つかりませんでした。
          </div>
        )}
      </aside>
    </div>
  );
}

function Row({
  icon: Icon,
  label,
  children,
}: {
  icon: React.ComponentType<{ className?: string; "aria-hidden"?: boolean }>;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="grid grid-cols-[110px_1fr] gap-3 items-start">
      <span className="inline-flex items-center gap-1.5 text-[11px] font-medium tracking-[0.12em] uppercase text-ink-400 [color:var(--color-ink-400)]">
        <Icon className="size-3" aria-hidden />
        {label}
      </span>
      <span className="text-ink-900 [color:var(--color-ink-900)]">{children}</span>
    </div>
  );
}

function Muted({ children }: { children: React.ReactNode }) {
  return <span className="text-ink-400 [color:var(--color-ink-400)]">{children}</span>;
}
