"use client";

import { Sparkles, Users, Send, ShieldCheck } from "lucide-react";
import { fmtNumber } from "@/lib/formatters";
import {
  OBJECTIVE_META,
  estimateReach,
  WARMUP_DAILY_CAP_BY_DAY,
  type WizardState,
} from "@/lib/wizard-schema";
import type { AccountOption } from "./step-delivery";

interface Props {
  state: WizardState;
  accounts: AccountOption[];
}

export function WizardPreview({ state, accounts }: Props) {
  const objective = state.step1?.objective;
  const reach = estimateReach(state.step3);
  const selectedIds = state.step5?.accountIds ?? [];
  const selected = accounts.filter((a) => selectedIds.includes(a.id));
  const minCap = selected.length
    ? Math.min(...selected.map((a) => WARMUP_DAILY_CAP_BY_DAY(a.warmupDay)))
    : 0;
  const effDaily = selected.length
    ? Math.min(state.step5?.dailyLimit ?? 25, minCap)
    : state.step5?.dailyLimit ?? 0;
  const dailyTotal = effDaily * selected.length;
  const days = dailyTotal > 0 ? Math.ceil(reach / dailyTotal) : null;

  return (
    <div className="card-solid p-5 sticky top-20">
      <div className="flex items-center gap-2 mb-3 text-[11px] font-medium tracking-[0.18em] uppercase text-[var(--color-brand-700)]">
        <Sparkles className="size-3.5" aria-hidden />
        プレビュー
      </div>
      <div className="space-y-3 text-[13px]">
        <Row label="目的">
          {objective ? OBJECTIVE_META[objective].ja : <Muted>未選択</Muted>}
        </Row>
        <Row label="会社">
          {state.step2?.companyName?.trim() || <Muted>未入力</Muted>}
        </Row>
        <Row label="推定リーチ">
          <span className="tabular font-mono text-[var(--color-brand-700)] font-semibold">
            {reach ? `${fmtNumber(reach)} 件` : <Muted>—</Muted>}
          </span>
        </Row>
        <Row label="担当アカウント">
          <span className="inline-flex items-center gap-1">
            <Users className="size-3 text-[var(--color-brand-600)]" aria-hidden />
            <span className="tabular font-mono">{selected.length}</span>
          </span>
        </Row>
        <Row label="日次合計上限">
          <span className="inline-flex items-center gap-1">
            <Send className="size-3 text-[var(--color-brand-600)]" aria-hidden />
            <span className="tabular font-mono">{dailyTotal} / 日</span>
          </span>
        </Row>
        <Row label="リーチ完了見込み">
          {days ? <span className="tabular font-mono">約 {days} 日</span> : <Muted>—</Muted>}
        </Row>
        <Row label="レビューモード">
          <span className="inline-flex items-center gap-1 text-[var(--color-brand-700)]">
            <ShieldCheck className="size-3" aria-hidden />
            {state.step5?.reviewMode === "semi_auto" ? "セミ自動" : "レビュー必須"}
          </span>
        </Row>
      </div>
      <div className="mt-4 pt-3 border-t border-[var(--color-ink-100)] text-[11px] text-ink-500 [color:var(--color-ink-500)] leading-relaxed">
        ローンチ後の設定変更は「実行中の設定との差分」表示と再承認が必要になります。
      </div>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-ink-500 [color:var(--color-ink-500)]">{label}</span>
      <span className="text-ink-900 [color:var(--color-ink-900)] truncate text-right">{children}</span>
    </div>
  );
}

function Muted({ children }: { children: React.ReactNode }) {
  return <span className="text-ink-400 [color:var(--color-ink-400)]">{children}</span>;
}
