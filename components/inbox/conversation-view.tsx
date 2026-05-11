"use client";

import * as React from "react";
import Link from "next/link";
import {
  CalendarCheck,
  ExternalLink,
  Briefcase,
  Building2,
  TrendingUp,
  Target,
  CheckCircle2,
  AlertCircle,
} from "lucide-react";
import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { StateChip } from "@/components/ui/state-chip";
import { Badge } from "@/components/ui/badge";
import { MessageBubble } from "@/components/inbox/message-bubble";
import { Composer } from "@/components/inbox/composer";
import {
  markAsMeeting,
  INITIAL_SEND_RESULT,
  type SendResult,
} from "@/server/actions/conversation";
import type { ConversationDetail, ConversationMessage } from "@/server/queries/conversation";
import { cn, safeExternalUrl } from "@/lib/utils";

/** Optimistic 送信中バブル: status を別途持つ */
type OptimisticMessage = ConversationMessage & { __status?: BubbleStatus };

interface Props {
  detail: ConversationDetail;
}

export function ConversationView({ detail }: Props) {
  const { lead } = detail;
  const [messages, setMessages] = React.useState<OptimisticMessage[]>(detail.messages);
  const [toast, setToast] = React.useState<{ kind: "success" | "error"; text: string } | null>(null);
  const safeLinkedinUrl = React.useMemo(() => safeExternalUrl(lead.linkedinUrl), [lead.linkedinUrl]);

  React.useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3500);
    return () => clearTimeout(t);
  }, [toast]);

  const tempIdRef = React.useRef<string | null>(null);

  const newTempId = () => {
    if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
      return `temp-${crypto.randomUUID()}`;
    }
    return `temp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  };

  const handleQueueing = (content: string, aiAssisted: boolean) => {
    // Optimistic に「送信中」吹き出しを追加 (id を ref で保持し成否で更新)
    const tempId = newTempId();
    tempIdRef.current = tempId;
    setMessages((prev) => [
      ...prev,
      {
        id: tempId,
        direction: "outbound",
        content,
        aiAssisted,
        sentAt: new Date().toISOString(),
        __status: "sending",
      },
    ]);
  };

  const handleConfirmed = (s: SendResult) => {
    setToast({ kind: s.ok ? "success" : "error", text: s.message ?? "" });
    const tempId = tempIdRef.current;
    if (!tempId) return;
    if (s.ok) {
      // 成功時は revalidate により server から本物のメッセージが入るのを待つ。
      // 一旦 status を sent に更新して UX を確定させる。
      setMessages((prev) =>
        prev.map((m) => (m.id === tempId ? { ...m, __status: "sent" } : m))
      );
    } else {
      // 失敗時はバブルを failed に切替、ユーザに再送 / 削除を促す
      setMessages((prev) =>
        prev.map((m) => (m.id === tempId ? { ...m, __status: "failed" } : m))
      );
    }
    tempIdRef.current = null;
  };

  // server から新しい messages が降ってきたら __status を解除
  React.useEffect(() => {
    setMessages(detail.messages);
  }, [detail.messages]);

  const lastInbound = messages.filter((m) => m.direction === "inbound").pop();

  return (
    <div className="flex-1 min-h-0 grid grid-cols-1 lg:grid-cols-[1fr_300px]">
      {/* メイン */}
      <div className="flex flex-col min-h-0">
        {/* Header */}
        <header className="border-b border-[var(--color-ink-100)] bg-white/85 backdrop-blur-md px-4 py-3 sticky top-0 z-10">
          <div className="flex items-start justify-between gap-3 flex-wrap">
            <div className="min-w-0">
              <h1 className="font-display text-[20px] font-bold tracking-tight text-ink-900 [color:var(--color-ink-900)] truncate">
                {lead.name}
              </h1>
              <div className="text-[12px] text-ink-500 [color:var(--color-ink-500)] truncate">
                {[lead.headline, lead.company].filter(Boolean).join(" · ") || "—"}
              </div>
            </div>
            <div className="flex items-center gap-2">
              <StateChip state={lead.state} size="md" />
              <Badge tone="brand">
                <TrendingUp className="size-3" aria-hidden />
                {lead.score}
              </Badge>
              {lead.state !== "MEETING" && (
                <MeetingForm leadId={lead.id} onResult={(s) => setToast({ kind: s.ok ? "success" : "error", text: s.message ?? "" })} />
              )}
            </div>
          </div>
        </header>

        {/* メッセージ履歴 */}
        <div className="flex-1 overflow-y-auto px-4 py-6 bg-[var(--color-ink-50)]/30">
          {messages.length === 0 ? (
            <div className="text-center text-[13px] text-ink-500 [color:var(--color-ink-500)] py-12">
              まだメッセージのやり取りはありません。
            </div>
          ) : (
            <div className="flex flex-col gap-3 max-w-[760px] mx-auto">
              <div className="flex items-center gap-2 text-[11px] text-ink-400 [color:var(--color-ink-400)] mb-2">
                <span className="h-px flex-1 bg-[var(--color-ink-200)]" aria-hidden />
                <span>{messages.length} 件のメッセージ</span>
                <span className="h-px flex-1 bg-[var(--color-ink-200)]" aria-hidden />
              </div>
              {messages.map((m) => (
                <MessageBubble
                  key={m.id}
                  direction={m.direction}
                  content={m.content}
                  aiAssisted={m.aiAssisted}
                  sentAt={m.sentAt}
                  status={
                    m.__status ?? (m.id.startsWith("temp-") ? "sending" : "delivered")
                  }
                />
              ))}
            </div>
          )}
        </div>

        <Composer
          leadId={lead.id}
          leadName={lead.name}
          recentInboundSnippet={lastInbound?.content ?? null}
          onConfirmed={handleConfirmed}
          onQueueing={handleQueueing}
        />
      </div>

      {/* 右ペイン: プロフィール */}
      <aside className="hidden lg:flex flex-col border-l border-[var(--color-ink-100)] bg-white overflow-y-auto">
        <div className="px-5 py-4 border-b border-[var(--color-ink-100)]">
          <div className="text-[10px] font-bold tracking-[0.18em] uppercase text-[var(--color-brand-700)] mb-1">
            Profile
          </div>
          <h2 className="font-display text-[16px] font-bold tracking-tight text-ink-900 [color:var(--color-ink-900)] truncate">
            {lead.name}
          </h2>
          {safeLinkedinUrl ? (
            <a
              href={safeLinkedinUrl}
              target="_blank"
              rel="noreferrer noopener"
              className="mt-1 inline-flex items-center gap-1 text-[12px] text-[var(--color-brand-700)] hover:underline"
            >
              LinkedIn で開く <ExternalLink className="size-3" aria-hidden />
            </a>
          ) : (
            <span className="mt-1 inline-flex items-center gap-1 text-[11px] text-ink-400 [color:var(--color-ink-400)]">
              LinkedIn URL が不正です
            </span>
          )}
        </div>

        <div className="px-5 py-4 space-y-3 text-[13px]">
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
        </div>

        <div className="px-5 py-4 border-t border-[var(--color-ink-100)]">
          <h3 className="text-[10px] font-bold tracking-[0.18em] uppercase text-ink-500 [color:var(--color-ink-500)] mb-2">
            CRM 状態
          </h3>
          <div className="text-[12px] text-ink-700 [color:var(--color-ink-700)]">
            {lead.state === "MEETING" ? (
              <Badge tone="success">
                <CalendarCheck className="size-3" aria-hidden />
                商談化済
              </Badge>
            ) : (
              <Muted>未連携 (Phase2)</Muted>
            )}
          </div>
        </div>

        <div className="px-5 py-4 border-t border-[var(--color-ink-100)] mt-auto bg-[var(--color-ink-50)]/40 text-[11px] text-ink-500 [color:var(--color-ink-500)] leading-relaxed">
          送信は <strong className="font-semibold">5 秒キュー Undo</strong> が動きます。送信ボタン押下後 5 秒以内なら取り消せます (設計書 §6.4)。
        </div>
      </aside>

      {toast && (
        <div
          role={toast.kind === "success" ? "status" : "alert"}
          aria-live="polite"
          className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 px-4"
        >
          <div
            className={cn(
              "flex items-center gap-2 rounded-full border px-4 py-2 text-[13px] font-medium shadow-[var(--shadow-popover)] bg-white",
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
        </div>
      )}
    </div>
  );
}

function MeetingForm({
  leadId,
  onResult,
}: {
  leadId: string;
  onResult: (s: SendResult) => void;
}) {
  const [state, formAction] = useActionState<SendResult, FormData>(
    markAsMeeting,
    INITIAL_SEND_RESULT
  );
  const reported = React.useRef<SendResult | null>(null);
  React.useEffect(() => {
    if (!state.message) return;
    if (reported.current === state) return;
    reported.current = state;
    onResult(state);
  }, [state, onResult]);

  return (
    <form
      action={formAction}
      onSubmit={(e) => {
        if (!window.confirm("このリードを商談化として記録します。よろしいですか？")) {
          e.preventDefault();
        }
      }}
      className="inline-flex"
    >
      <input type="hidden" name="leadId" value={leadId} />
      <Button type="submit" variant="secondary" size="sm">
        <CalendarCheck className="size-3.5" aria-hidden />
        商談化
      </Button>
    </form>
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
    <div className="grid grid-cols-[100px_1fr] gap-3 items-start">
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
