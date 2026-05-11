"use client";

import * as React from "react";
import Link from "next/link";
import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import {
  ChevronLeft,
  Pause,
  Play,
  Archive,
  ShieldCheck,
  CheckCircle2,
  AlertCircle,
} from "lucide-react";
import { CampaignStatusChip } from "@/components/campaigns/campaign-status-chip";
import { Badge } from "@/components/ui/badge";
import {
  singleCampaignAction,
  INITIAL_BULK_STATE,
  type BulkActionState,
} from "@/server/actions/campaigns";
import type { CampaignStatus } from "@/lib/campaign-status";
import { cn } from "@/lib/utils";

interface Props {
  id: string;
  name: string;
  status: CampaignStatus;
  hitlState: "REVIEW_REQUIRED" | "SEMI_AUTO" | "FULL_AUTO";
  ownerName: string | null;
  startsAt: string | null;
}

export function DetailHeader({ id, name, status, hitlState, ownerName, startsAt }: Props) {
  const [toast, setToast] = React.useState<{ kind: "success" | "error"; text: string } | null>(null);
  React.useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3500);
    return () => clearTimeout(t);
  }, [toast]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <Link
          href="/campaigns"
          className="inline-flex items-center gap-1 text-[12px] text-ink-500 [color:var(--color-ink-500)] hover:text-ink-900 underline-offset-4 hover:underline"
        >
          <ChevronLeft className="size-3.5" aria-hidden />
          キャンペーン一覧へ戻る
        </Link>
        <div className="flex items-center gap-2">
          {status === "running" ? (
            <ActionForm
              id={id}
              action="pause"
              icon={Pause}
              label="一時停止"
              confirmMessage="このキャンペーンを一時停止します。よろしいですか？"
              onResult={(s) => setToast({ kind: s.ok ? "success" : "error", text: s.message ?? "" })}
            />
          ) : status === "paused" ? (
            <ActionForm
              id={id}
              action="resume"
              icon={Play}
              label="再開"
              onResult={(s) => setToast({ kind: s.ok ? "success" : "error", text: s.message ?? "" })}
            />
          ) : null}
          {status !== "completed" && (
            <ActionForm
              id={id}
              action="archive"
              icon={Archive}
              label="アーカイブ"
              destructive
              confirmMessage="このキャンペーンをアーカイブします。実行中のジョブは停止されます。よろしいですか？"
              onResult={(s) => setToast({ kind: s.ok ? "success" : "error", text: s.message ?? "" })}
            />
          )}
        </div>
      </div>

      <div className="flex items-start justify-between flex-wrap gap-4">
        <div className="min-w-0">
          <h1 className="font-display text-[26px] lg:text-[34px] font-bold tracking-tight text-ink-900 [color:var(--color-ink-900)] leading-[1.1]">
            {name}
          </h1>
          <div className="mt-2 flex items-center flex-wrap gap-2 text-[12px] text-ink-500 [color:var(--color-ink-500)]">
            <CampaignStatusChip status={status} />
            <Badge tone="brand">
              <ShieldCheck className="size-3" aria-hidden />
              {hitlState === "FULL_AUTO" ? "自動送信" : hitlState === "SEMI_AUTO" ? "セミ自動" : "レビュー必須"}
            </Badge>
            {ownerName && <span>担当: {ownerName}</span>}
            {startsAt && (
              <span className="tabular font-mono">
                開始: {new Intl.DateTimeFormat("ja-JP", { timeZone: "Asia/Tokyo", month: "long", day: "numeric" }).format(new Date(startsAt))}
              </span>
            )}
          </div>
        </div>
      </div>

      {toast && (
        <div
          role={toast.kind === "success" ? "status" : "alert"}
          aria-live="polite"
          className={cn(
            "inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-[12px] font-medium bg-white",
            toast.kind === "success"
              ? "border-[#A7F3D0] text-[var(--color-success-700)]"
              : "border-[#FECACA] text-[var(--color-danger-700)]"
          )}
        >
          {toast.kind === "success" ? (
            <CheckCircle2 className="size-4" aria-hidden />
          ) : (
            <AlertCircle className="size-4" aria-hidden />
          )}
          {toast.text}
        </div>
      )}
    </div>
  );
}

function ActionForm({
  id,
  action,
  icon: Icon,
  label,
  confirmMessage,
  destructive,
  onResult,
}: {
  id: string;
  action: "pause" | "resume" | "archive";
  icon: React.ComponentType<{ className?: string; "aria-hidden"?: boolean }>;
  label: string;
  confirmMessage?: string;
  destructive?: boolean;
  onResult: (s: BulkActionState) => void;
}) {
  const [state, formAction] = useActionState<BulkActionState, FormData>(
    singleCampaignAction,
    INITIAL_BULK_STATE
  );
  // メッセージ参照単位で通知 (同一参照の二重通知を避けつつ、affected=0 の error 等も確実に届ける)
  const reportedRef = React.useRef<BulkActionState | null>(null);
  React.useEffect(() => {
    if (!state.message) return;
    if (reportedRef.current === state) return;
    reportedRef.current = state;
    onResult(state);
  }, [state, onResult]);

  return (
    <form
      action={formAction}
      onSubmit={(e) => {
        if (confirmMessage && !window.confirm(confirmMessage)) {
          e.preventDefault();
        }
      }}
      className="inline-flex"
    >
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="action" value={action} />
      <ActionSubmit icon={Icon} label={label} destructive={destructive} />
    </form>
  );
}

function ActionSubmit({
  icon: Icon,
  label,
  destructive,
}: {
  icon: React.ComponentType<{ className?: string; "aria-hidden"?: boolean }>;
  label: string;
  destructive?: boolean;
}) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className={cn(
        "inline-flex items-center gap-1.5 h-9 px-3 rounded-full border text-[12px] font-medium transition",
        destructive
          ? "border-[#FECACA] text-[var(--color-danger-700)] hover:bg-[var(--color-danger-50)]"
          : "border-[var(--color-ink-200)] text-ink-700 hover:border-[var(--color-brand-300)] hover:bg-[var(--color-brand-50)]",
        pending && "opacity-60 pointer-events-none"
      )}
    >
      {pending ? (
        <span aria-hidden className="size-3.5 rounded-full border-2 border-current border-r-transparent animate-spin" />
      ) : (
        <Icon className="size-3.5" aria-hidden />
      )}
      {label}
    </button>
  );
}
