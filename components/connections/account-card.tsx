"use client";

import * as React from "react";
import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import {
  Pause,
  Play,
  ShieldAlert,
  Hourglass,
  Unplug,
  Pencil,
  CheckCircle2,
  Send,
  X,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  pauseConnection,
  resumeConnection,
  updateDailyLimit,
  disconnectAccount,
  INITIAL_CONNECTION_STATE,
  type ConnectionActionState,
} from "@/server/actions/connections";
import type { LinkedinAccount } from "@/server/queries/connections";
import { fmtNumber, fmtRelative } from "@/lib/formatters";
import { cn } from "@/lib/utils";

interface Props {
  account: LinkedinAccount;
  onResult: (s: ConnectionActionState) => void;
}

export function AccountCard({ account, onResult }: Props) {
  const [mode, setMode] = React.useState<"view" | "limit" | "disconnect" | "pause">("view");

  const isSafeMode = account.status === "safe_mode";
  const isDisconnected = account.status === "disconnected";
  const isWarming = account.status === "warming";
  const effectiveLimit = Math.min(account.dailyLimit, account.warmupCap);
  const sentPct = effectiveLimit > 0
    ? Math.min(100, Math.round((account.todaySent / effectiveLimit) * 100))
    : 0;

  return (
    <article
      className={cn(
        "card-solid p-5 space-y-4 transition",
        isSafeMode && "border-[#FECACA] bg-[var(--color-danger-50)]/30",
        isDisconnected && "opacity-70"
      )}
      aria-labelledby={`acc-${account.id}`}
    >
      {/* Header */}
      <header className="flex items-start justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-3 min-w-0">
          <div
            aria-hidden
            className={cn(
              "size-10 rounded-xl grid place-content-center text-white text-[14px] font-bold tracking-tight shrink-0",
              isSafeMode
                ? "bg-[linear-gradient(135deg,#F87171,#DC2626)]"
                : "bg-[linear-gradient(135deg,#7DD3FC,#0EA5E9)]"
            )}
          >
            {account.displayName.slice(0, 2)}
          </div>
          <div className="min-w-0">
            <h3
              id={`acc-${account.id}`}
              className="font-display text-[16px] font-bold tracking-tight text-ink-900 [color:var(--color-ink-900)] truncate"
            >
              {account.displayName}
            </h3>
            <div className="text-[11px] text-ink-500 [color:var(--color-ink-500)] font-mono tabular">
              Unipile: {account.unipileAccountId}
            </div>
          </div>
        </div>
        <StatusBadge status={account.status} />
      </header>

      {/* メトリクス */}
      <section className="grid grid-cols-3 gap-3">
        <Metric label="本日の送信" value={`${fmtNumber(account.todaySent)} / ${effectiveLimit}`}>
          <ProgressBar percent={sentPct} tone={sentPct > 90 ? "warning" : "brand"} />
        </Metric>
        <Metric label="本日の返信" value={fmtNumber(account.todayReplied)} />
        <Metric
          label="ウォームアップ"
          value={
            isWarming
              ? `Day ${account.warmupDay}/14`
              : account.warmupDay >= 14
              ? "完了"
              : "—"
          }
        >
          {isWarming && (
            <ProgressBar
              percent={(account.warmupDay / 14) * 100}
              tone="brand"
              label={`安全上限 ${account.warmupCap} 件/日 (自動)`}
            />
          )}
        </Metric>
      </section>

      {/* 安全モード警告 */}
      {isSafeMode && (
        <div
          role="alert"
          className="rounded-xl border border-[#FECACA] bg-white px-3.5 py-2.5 text-[12px] text-[var(--color-danger-700)] flex items-start gap-2"
        >
          <ShieldAlert className="size-4 mt-0.5 shrink-0" aria-hidden />
          <div className="leading-relaxed">
            <div className="font-semibold">安全モード作動中 — 自動送信を停止しています</div>
            <div className="mt-1 text-ink-700 [color:var(--color-ink-700)]">
              推奨アクション: ①{" "}
              {account.lastWarningAt ? (
                <>
                  最終警告: <span className="tabular font-mono">{fmtRelative(account.lastWarningAt)}</span>{" "}
                </>
              ) : null}
              12 時間クールダウン / ② 手動 LinkedIn ログイン確認 / ③ サポート連絡
            </div>
          </div>
        </div>
      )}

      {/* インライン編集パネル */}
      {mode === "limit" && (
        <LimitForm
          accountId={account.id}
          current={account.dailyLimit}
          warmupCap={account.warmupCap}
          onClose={() => setMode("view")}
          onResult={onResult}
        />
      )}

      {mode === "pause" && (
        <PauseForm accountId={account.id} onClose={() => setMode("view")} onResult={onResult} />
      )}

      {mode === "disconnect" && (
        <DisconnectForm accountId={account.id} onClose={() => setMode("view")} onResult={onResult} />
      )}

      {/* アクション */}
      {mode === "view" && (
        <footer className="flex items-center flex-wrap gap-2 pt-2 border-t border-[var(--color-ink-100)]">
          {!isDisconnected && !isSafeMode && (
            <button
              type="button"
              onClick={() => setMode("pause")}
              className="inline-flex items-center gap-1.5 h-8 px-3 rounded-full border border-[var(--color-ink-200)] bg-white text-[12px] text-ink-700 [color:var(--color-ink-700)] hover:border-[var(--color-warning-700)] hover:bg-[var(--color-warning-50)] transition"
            >
              <Pause className="size-3.5" aria-hidden />
              一時停止
            </button>
          )}
          {isSafeMode && (
            <ResumeForm accountId={account.id} onResult={onResult} />
          )}
          {!isDisconnected && (
            <>
              <button
                type="button"
                onClick={() => setMode("limit")}
                className="inline-flex items-center gap-1.5 h-8 px-3 rounded-full border border-[var(--color-ink-200)] bg-white text-[12px] text-ink-700 [color:var(--color-ink-700)] hover:border-[var(--color-brand-300)] hover:bg-[var(--color-brand-50)] transition"
              >
                <Pencil className="size-3.5" aria-hidden />
                上限を編集
              </button>
              <button
                type="button"
                onClick={() => setMode("disconnect")}
                className="inline-flex items-center gap-1.5 h-8 px-3 rounded-full border border-[#FECACA] bg-white text-[12px] text-[var(--color-danger-700)] hover:bg-[var(--color-danger-50)] transition"
              >
                <Unplug className="size-3.5" aria-hidden />
                接続を切る
              </button>
            </>
          )}
          <span className="ml-auto text-[11px] text-ink-400 [color:var(--color-ink-400)]">
            所有者: {account.ownerName ?? "—"}
          </span>
        </footer>
      )}
    </article>
  );
}

function StatusBadge({ status }: { status: LinkedinAccount["status"] }) {
  if (status === "safe_mode") {
    return (
      <Badge tone="danger">
        <ShieldAlert className="size-3" aria-hidden /> 安全モード
      </Badge>
    );
  }
  if (status === "warming") {
    return (
      <Badge tone="warning">
        <Hourglass className="size-3 pulse-soft" aria-hidden /> ウォームアップ
      </Badge>
    );
  }
  if (status === "disconnected") {
    return (
      <Badge tone="neutral">
        <Unplug className="size-3" aria-hidden /> 切断済
      </Badge>
    );
  }
  return (
    <Badge tone="success">
      <CheckCircle2 className="size-3" aria-hidden /> アクティブ
    </Badge>
  );
}

function Metric({
  label,
  value,
  children,
}: {
  label: string;
  value: React.ReactNode;
  children?: React.ReactNode;
}) {
  return (
    <div>
      <div className="text-[10px] tracking-[0.16em] font-medium uppercase text-ink-400 [color:var(--color-ink-400)]">
        {label}
      </div>
      <div className="mt-1 font-display font-bold text-[18px] tabular tracking-tight text-ink-900 [color:var(--color-ink-900)]">
        {value}
      </div>
      {children}
    </div>
  );
}

function ProgressBar({
  percent,
  tone,
  label,
}: {
  percent: number;
  tone: "brand" | "warning";
  label?: string;
}) {
  return (
    <div className="mt-2">
      <div
        role="progressbar"
        aria-valuenow={Math.round(percent)}
        aria-valuemin={0}
        aria-valuemax={100}
        className="h-1.5 rounded-full bg-[var(--color-ink-100)] overflow-hidden"
      >
        <div
          className={cn(
            "h-full",
            tone === "warning"
              ? "bg-[linear-gradient(90deg,#F59E0B,#B45309)]"
              : "bg-[linear-gradient(90deg,#7DD3FC,#0EA5E9,#14B8A6)]"
          )}
          style={{ width: `${Math.max(2, percent)}%` }}
        />
      </div>
      {label && (
        <div className="text-[10px] text-ink-400 [color:var(--color-ink-400)] mt-1">{label}</div>
      )}
    </div>
  );
}

/* --- Forms --- */

function LimitForm({
  accountId,
  current,
  warmupCap,
  onClose,
  onResult,
}: {
  accountId: string;
  current: number;
  warmupCap: number;
  onClose: () => void;
  onResult: (s: ConnectionActionState) => void;
}) {
  const [state, formAction] = useActionState<ConnectionActionState, FormData>(
    updateDailyLimit,
    INITIAL_CONNECTION_STATE
  );
  const reported = React.useRef<ConnectionActionState | null>(null);
  React.useEffect(() => {
    if (!state.message) return;
    if (reported.current === state) return;
    reported.current = state;
    onResult(state);
    if (state.ok) onClose();
  }, [state, onResult, onClose]);

  return (
    <form action={formAction} className="rounded-xl border border-[var(--color-brand-200)] bg-[var(--color-brand-50)]/40 p-3 space-y-2">
      <input type="hidden" name="accountId" value={accountId} />
      <label className="block">
        <span className="text-[11px] font-medium text-ink-700 [color:var(--color-ink-700)]">
          日次上限 (1-200)
        </span>
        <Input
          type="number"
          name="dailyLimit"
          min={1}
          max={200}
          defaultValue={current}
          className="mt-1.5 h-9 text-[13px]"
        />
        <span className="text-[10px] text-ink-500 [color:var(--color-ink-500)] block mt-1">
          ウォームアップ段階の自動上限 {warmupCap} 件/日 を超える値は実行時に押し戻されます
        </span>
      </label>
      <div className="flex items-center justify-end gap-2">
        <Button type="button" variant="ghost" size="sm" onClick={onClose}>
          <X className="size-3.5" aria-hidden /> キャンセル
        </Button>
        <SubmitButton label="保存" icon={Send} />
      </div>
    </form>
  );
}

function PauseForm({
  accountId,
  onClose,
  onResult,
}: {
  accountId: string;
  onClose: () => void;
  onResult: (s: ConnectionActionState) => void;
}) {
  const [state, formAction] = useActionState<ConnectionActionState, FormData>(
    pauseConnection,
    INITIAL_CONNECTION_STATE
  );
  const reported = React.useRef<ConnectionActionState | null>(null);
  React.useEffect(() => {
    if (!state.message) return;
    if (reported.current === state) return;
    reported.current = state;
    onResult(state);
    if (state.ok) onClose();
  }, [state, onResult, onClose]);

  return (
    <form
      action={formAction}
      className="rounded-xl border border-[#FDE68A] bg-[var(--color-warning-50)] p-3 space-y-2"
    >
      <input type="hidden" name="accountId" value={accountId} />
      <div className="text-[12px] font-medium text-[var(--color-warning-700)] inline-flex items-center gap-1">
        <Pause className="size-3.5" aria-hidden /> 一時停止する理由 (監査ログに記録されます)
      </div>
      <textarea
        name="reason"
        rows={2}
        maxLength={400}
        required
        placeholder="例: クールダウン期間として 24h 停止"
        className="block w-full px-3 py-2 rounded-xl border border-[var(--color-ink-200)] bg-white text-[13px] focus:border-[var(--color-warning-700)] resize-none"
      />
      <div className="flex items-center justify-end gap-2">
        <Button type="button" variant="ghost" size="sm" onClick={onClose}>
          <X className="size-3.5" aria-hidden /> キャンセル
        </Button>
        <SubmitButton label="一時停止する" icon={Pause} destructive />
      </div>
    </form>
  );
}

function DisconnectForm({
  accountId,
  onClose,
  onResult,
}: {
  accountId: string;
  onClose: () => void;
  onResult: (s: ConnectionActionState) => void;
}) {
  const [state, formAction] = useActionState<ConnectionActionState, FormData>(
    disconnectAccount,
    INITIAL_CONNECTION_STATE
  );
  const [confirmText, setConfirmText] = React.useState("");
  const reported = React.useRef<ConnectionActionState | null>(null);
  React.useEffect(() => {
    if (!state.message) return;
    if (reported.current === state) return;
    reported.current = state;
    onResult(state);
    if (state.ok) onClose();
  }, [state, onResult, onClose]);

  return (
    <form
      action={formAction}
      className="rounded-xl border border-[#FECACA] bg-[var(--color-danger-50)]/50 p-3 space-y-2"
    >
      <input type="hidden" name="accountId" value={accountId} />
      <div className="text-[12px] font-medium text-[var(--color-danger-700)] inline-flex items-center gap-1">
        <Unplug className="size-3.5" aria-hidden /> 接続を切る (7 日以内は復元可能)
      </div>
      <p className="text-[11px] text-ink-700 [color:var(--color-ink-700)] leading-relaxed">
        実行中のジョブ / 予約は中断されます。確認のため <code className="font-mono px-1.5 py-0.5 bg-white rounded text-[var(--color-danger-700)] border border-[#FECACA]">DISCONNECT</code> と入力してください。
      </p>
      <Input
        name="confirm"
        value={confirmText}
        onChange={(e) => setConfirmText(e.target.value)}
        placeholder="DISCONNECT"
        autoComplete="off"
        className="h-9 text-[13px] font-mono tabular"
      />
      <div className="flex items-center justify-end gap-2">
        <Button type="button" variant="ghost" size="sm" onClick={onClose}>
          <X className="size-3.5" aria-hidden /> キャンセル
        </Button>
        <SubmitButton
          label="接続を切る"
          icon={Unplug}
          destructive
          disabled={confirmText.trim() !== "DISCONNECT"}
        />
      </div>
    </form>
  );
}

function ResumeForm({
  accountId,
  onResult,
}: {
  accountId: string;
  onResult: (s: ConnectionActionState) => void;
}) {
  const [state, formAction] = useActionState<ConnectionActionState, FormData>(
    resumeConnection,
    INITIAL_CONNECTION_STATE
  );
  const reported = React.useRef<ConnectionActionState | null>(null);
  React.useEffect(() => {
    if (!state.message) return;
    if (reported.current === state) return;
    reported.current = state;
    onResult(state);
  }, [state, onResult]);

  return (
    <form action={formAction} className="inline-flex">
      <input type="hidden" name="accountId" value={accountId} />
      <SubmitButton label="再開する" icon={Play} />
    </form>
  );
}

function SubmitButton({
  label,
  icon: Icon,
  destructive,
  disabled,
}: {
  label: string;
  icon: React.ComponentType<{ className?: string; "aria-hidden"?: boolean }>;
  destructive?: boolean;
  disabled?: boolean;
}) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending || disabled}
      className={cn(
        "inline-flex items-center gap-1.5 h-8 px-3.5 rounded-full text-[12px] font-medium transition",
        destructive
          ? "bg-[var(--color-danger-500)] text-white hover:bg-[var(--color-danger-700)]"
          : "bg-[var(--color-brand-500)] text-white hover:bg-[var(--color-brand-700)] shadow-[0_8px_24px_-12px_rgba(14,165,233,0.55)]",
        (pending || disabled) && "opacity-60 pointer-events-none"
      )}
    >
      {pending ? (
        <span aria-hidden className="size-3.5 rounded-full border-2 border-white border-r-transparent animate-spin" />
      ) : (
        <Icon className="size-3.5" aria-hidden />
      )}
      {label}
    </button>
  );
}
