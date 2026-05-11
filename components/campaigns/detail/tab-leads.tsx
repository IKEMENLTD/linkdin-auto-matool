import Link from "next/link";
import { ChevronRight, Users } from "lucide-react";
import { StateChip } from "@/components/ui/state-chip";
import { EmptyState } from "@/components/ui/empty-state";
import { fmtRelative } from "@/lib/formatters";
import type { CampaignDetail } from "@/server/queries/campaign-detail";

export function TabLeads({ detail }: { detail: CampaignDetail }) {
  if (detail.leads.length === 0) {
    return (
      <EmptyState
        icon={Users}
        title="まだリードがありません"
        description="キャンペーンを開始すると、24 時間以内に最初のリードが現れます。"
        primary={{ label: "ダッシュボードへ戻る", href: "/dashboard" }}
      />
    );
  }

  return (
    <div className="card-solid overflow-hidden">
      <div className="hidden md:grid grid-cols-[1.6fr_120px_70px_140px_32px] gap-2 px-4 py-2.5 border-b border-[var(--color-ink-100)] bg-[var(--color-ink-50)]/60 text-[11px] font-medium tracking-[0.12em] uppercase text-ink-500 [color:var(--color-ink-500)]">
        <div>名前 / 会社</div>
        <div>状態</div>
        <div className="text-right">スコア</div>
        <div>最終アクション</div>
        <div />
      </div>
      <ul className="divide-y divide-[var(--color-ink-100)]">
        {detail.leads.map((lead) => (
          <li key={lead.id}>
            <Link
              href={`/leads/${lead.id}`}
              className="grid grid-cols-1 md:grid-cols-[1.6fr_120px_70px_140px_32px] gap-2 items-center px-4 py-3 hover:bg-[var(--color-brand-50)]/60 transition"
            >
              <div className="min-w-0">
                <div className="font-medium text-[13.5px] text-ink-900 [color:var(--color-ink-900)] truncate">
                  {lead.name}
                </div>
                <div className="text-[11px] text-ink-500 [color:var(--color-ink-500)] truncate">
                  {[lead.headline, lead.company].filter(Boolean).join(" · ") || "—"}
                </div>
                <div className="md:hidden mt-1 flex items-center gap-2">
                  <StateChip state={lead.state} />
                  <span className="text-[11px] tabular font-mono text-ink-500 [color:var(--color-ink-500)]">
                    {lead.score}
                  </span>
                </div>
              </div>
              <div className="hidden md:flex items-center">
                <StateChip state={lead.state} />
              </div>
              <div className="hidden md:block text-right tabular font-mono text-[13px] text-ink-700 [color:var(--color-ink-700)]">
                {lead.score}
              </div>
              <div className="hidden md:block text-[12px] text-ink-500 [color:var(--color-ink-500)] tabular font-mono">
                {lead.lastActionAt ? fmtRelative(lead.lastActionAt) : "未開始"}
              </div>
              <ChevronRight
                className="hidden md:block size-4 text-ink-300 [color:var(--color-ink-300)] justify-self-end"
                aria-hidden
              />
            </Link>
          </li>
        ))}
      </ul>
      <div className="px-4 py-3 border-t border-[var(--color-ink-100)] text-[11px] text-ink-500 [color:var(--color-ink-500)] flex items-center justify-between">
        <span>直近 25 件 (最終アクション順)</span>
        <Link
          href={`/leads?campaign=${detail.id}`}
          className="text-[var(--color-brand-700)] hover:underline inline-flex items-center gap-1"
        >
          このキャンペーンのリード一覧を見る <ChevronRight className="size-3.5" aria-hidden />
        </Link>
      </div>
    </div>
  );
}
