"use client";

import * as React from "react";
import { useActionState } from "react";
import {
  Sparkles,
  Send,
  X,
  AlertTriangle,
  RotateCcw,
  Eye,
  ThumbsDown,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  sendMessage,
  type SendResult,
} from "@/server/actions/conversation";
import { INITIAL_SEND_RESULT } from "@/lib/action-state";
import { detectDlpViolation } from "@/lib/dlp";
import { cn } from "@/lib/utils";

interface Props {
  leadId: string;
  leadName: string;
  recentInboundSnippet?: string | null;
  /** 5 秒 Undo 完了後の actual 送信時に呼ばれるトースト通知 */
  onConfirmed: (result: SendResult) => void;
  /** Optimistic 送信中のメッセージを表示するためのコールバック */
  onQueueing?: (content: string, aiAssisted: boolean) => void;
}

type DraftVariant = { key: "a" | "b" | "c"; label: string; tone: string; body: string };

function buildDrafts(name: string, snippet: string | null): DraftVariant[] {
  const greeting = "ご返信ありがとうございます。";
  const firstName = name.split(" ")[0] ?? name;
  const hint = snippet
    ? `「${snippet.slice(0, 40)}${snippet.length > 40 ? "…" : ""}」の件、`
    : "";
  return [
    {
      key: "a",
      label: "案 A",
      tone: "フォーマル",
      body: `${greeting}${hint}補足としてお伺いしたい点が 2 点ございます。1) 現在の体制と月次商談数の目安、2) ご検討のタイミング感、いただけますと幸いです。`,
    },
    {
      key: "b",
      label: "案 B",
      tone: "事例提示",
      body: `${greeting}${hint}類似業界の事例として、初回返信率が +12pt 改善したケースを 1 枚にまとめております。よろしければ次回お打ち合わせ時にお見せできますが、いかがでしょうか。`,
    },
    {
      key: "c",
      label: "案 C",
      tone: "提案・打診",
      body: `${greeting}${hint}差し支えなければ、来週どこかで 25 分ほどお時間頂戴できますでしょうか。${firstName} 様のご状況に合わせて、最も活用度が高い 2 機能をデモいたします。`,
    },
  ];
}

const UNDO_MS = 5000;

export function Composer({
  leadId,
  leadName,
  recentInboundSnippet,
  onConfirmed,
  onQueueing,
}: Props) {
  const drafts = React.useMemo(
    () => buildDrafts(leadName, recentInboundSnippet ?? null),
    [leadName, recentInboundSnippet]
  );

  const [content, setContent] = React.useState("");
  const [activeDraft, setActiveDraft] = React.useState<DraftVariant["key"] | null>(null);
  const [showAi, setShowAi] = React.useState(true);
  const [aiAssisted, setAiAssisted] = React.useState(false);

  // 5 秒キュー Undo
  const [pendingContent, setPendingContent] = React.useState<string | null>(null);
  const [secondsLeft, setSecondsLeft] = React.useState(0);
  const intervalRef = React.useRef<ReturnType<typeof setInterval> | null>(null);
  const formActionRef = React.useRef<((fd: FormData) => void) | null>(null);

  const [result, formAction] = useActionState<SendResult, FormData>(
    sendMessage,
    INITIAL_SEND_RESULT
  );
  React.useEffect(() => {
    formActionRef.current = formAction;
  }, [formAction]);

  // result 通知
  const reportedRef = React.useRef<SendResult | null>(null);
  React.useEffect(() => {
    if (!result.message) return;
    if (reportedRef.current === result) return;
    reportedRef.current = result;
    onConfirmed(result);
    if (result.ok) {
      setContent("");
      setActiveDraft(null);
      setAiAssisted(false);
    }
  }, [result, onConfirmed]);

  // タイマー
  React.useEffect(() => {
    if (pendingContent == null) return;
    setSecondsLeft(Math.ceil(UNDO_MS / 1000));
    const startedAt = Date.now();
    intervalRef.current = setInterval(() => {
      const remaining = Math.max(0, UNDO_MS - (Date.now() - startedAt));
      setSecondsLeft(Math.ceil(remaining / 1000));
      if (remaining <= 0) {
        clearInterval(intervalRef.current!);
        intervalRef.current = null;
        // 確定送信
        const fd = new FormData();
        fd.append("leadId", leadId);
        fd.append("content", pendingContent);
        if (aiAssisted) fd.append("aiAssisted", "true");
        formActionRef.current?.(fd);
        setPendingContent(null);
      }
    }, 200);
    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [pendingContent, leadId, aiAssisted]);

  const startQueue = () => {
    const trimmed = content.trim();
    if (!trimmed) return;
    if (!window.confirm(`${leadName} 様にこのメッセージを送信します。\n\n${trimmed.slice(0, 200)}${trimmed.length > 200 ? "…" : ""}`)) {
      return;
    }
    setPendingContent(trimmed);
    onQueueing?.(trimmed, aiAssisted);
  };

  const cancelQueue = () => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
    setPendingContent(null);
    setSecondsLeft(0);
    // フォームを元の値で復元
  };

  const adoptDraft = (d: DraftVariant) => {
    setContent(d.body);
    setActiveDraft(d.key);
    setAiAssisted(true);
  };

  // 機微情報の警告 (UI 側でも事前に出す、Server と同じ DLP を共有)
  const dangerHint = React.useMemo(() => {
    if (!content.trim()) return null;
    const violation = detectDlpViolation(content);
    if (!violation) return null;
    return `${violation.reason} らしき記述があります。送信は Manager 以上の承認が必要です`;
  }, [content]);

  return (
    <div className="sticky bottom-0 border-t border-[var(--color-ink-100)] bg-[linear-gradient(180deg,rgba(255,255,255,0.6),rgba(255,255,255,0.95))] backdrop-blur-md">
      {/* AI Draft Panel */}
      {showAi && pendingContent == null && (
        <div className="px-4 pt-3 pb-2">
          <div className="flex items-center justify-between mb-2">
            <div className="inline-flex items-center gap-1.5 text-[11px] font-bold tracking-[0.18em] uppercase text-[var(--color-brand-700)]">
              <Sparkles className="size-3" aria-hidden />
              AI 下書き案
            </div>
            <button
              type="button"
              onClick={() => setShowAi(false)}
              className="text-[11px] text-ink-500 [color:var(--color-ink-500)] hover:text-ink-900 inline-flex items-center gap-1"
            >
              <X className="size-3" aria-hidden /> 閉じる
            </button>
          </div>
          <div className="grid sm:grid-cols-3 gap-2">
            {drafts.map((d) => {
              const active = activeDraft === d.key;
              return (
                <button
                  type="button"
                  key={d.key}
                  onClick={() => adoptDraft(d)}
                  className={cn(
                    "text-left rounded-xl border bg-white p-3 hover:bg-[var(--color-brand-50)]/60 transition",
                    active
                      ? "border-[var(--color-brand-500)] shadow-[0_8px_20px_-14px_rgba(14,165,233,0.5)] bg-[linear-gradient(180deg,rgba(240,249,255,0.6),white)]"
                      : "border-[var(--color-ink-200)]"
                  )}
                >
                  <div className="flex items-center justify-between gap-2 mb-1.5">
                    <span className="text-[11px] font-bold text-ink-900 [color:var(--color-ink-900)]">
                      {d.label}
                    </span>
                    <span className="text-[10px] text-ink-500 [color:var(--color-ink-500)]">{d.tone}</span>
                  </div>
                  <p className="text-[12px] text-ink-700 [color:var(--color-ink-700)] leading-relaxed line-clamp-4">
                    {d.body}
                  </p>
                  <div className="mt-2 inline-flex items-center gap-1 text-[11px] text-[var(--color-brand-700)]">
                    {active ? "編集中" : "編集して使う"}
                  </div>
                </button>
              );
            })}
          </div>
          <div className="mt-2 flex items-center justify-between gap-2 flex-wrap">
            <button
              type="button"
              onClick={() => {
                setActiveDraft(null);
                setAiAssisted(false);
                setContent("");
              }}
              className="inline-flex items-center gap-1 text-[11px] text-ink-500 [color:var(--color-ink-500)] hover:text-ink-900 underline-offset-4 hover:underline"
              aria-label="AI 案を採用しない (フォームを空にする)"
            >
              <ThumbsDown className="size-3" aria-hidden /> どの案も採用しない
            </button>
            <button
              type="button"
              disabled
              className="inline-flex items-center gap-1 text-[11px] text-ink-400 [color:var(--color-ink-400)] cursor-not-allowed"
              title="Phase2 で実装予定"
            >
              <Eye className="size-3" aria-hidden /> 根拠を見る (Phase2)
            </button>
          </div>
        </div>
      )}

      {!showAi && pendingContent == null && (
        <div className="px-4 pt-2">
          <button
            type="button"
            onClick={() => setShowAi(true)}
            className="text-[11px] text-[var(--color-brand-700)] hover:underline inline-flex items-center gap-1"
          >
            <Sparkles className="size-3" aria-hidden /> AI 下書きを表示
          </button>
        </div>
      )}

      {/* Pending Undo bar */}
      {pendingContent != null && (
        <div
          role="status"
          aria-live="polite"
          className="mx-4 my-3 flex items-center gap-3 rounded-xl border border-[var(--color-brand-300)] bg-[linear-gradient(180deg,rgba(186,230,253,0.45),white)] px-4 py-3"
        >
          <Send className="size-4 text-[var(--color-brand-700)]" aria-hidden />
          <div className="flex-1 text-[13px] text-ink-900 [color:var(--color-ink-900)]">
            <div className="font-medium">
              {secondsLeft} 秒後に送信されます
            </div>
            <div className="text-[11px] text-ink-500 [color:var(--color-ink-500)]">
              キャンセルすると下書きはフォームに戻ります
            </div>
          </div>
          <Button type="button" variant="secondary" size="sm" onClick={cancelQueue}>
            <RotateCcw className="size-3.5" aria-hidden />
            取り消す
          </Button>
        </div>
      )}

      {/* Composer */}
      {pendingContent == null && (
        <div className="px-4 py-3">
          <div className="flex items-center justify-between mb-1.5">
            <div className="text-[11px] text-ink-500 [color:var(--color-ink-500)] inline-flex items-center gap-1">
              <span className="font-medium text-ink-700 [color:var(--color-ink-700)]">{leadName}</span>
              <span aria-hidden>へ返信</span>
            </div>
            <span className="text-[10px] tabular font-mono text-ink-400 [color:var(--color-ink-400)]">
              {content.length} / 1500
            </span>
          </div>
          <textarea
            value={content}
            onChange={(e) => setContent(e.target.value)}
            rows={3}
            maxLength={1500}
            placeholder="返信を書く…（IME 中の Enter では送信されません）"
            aria-label="返信メッセージ"
            className="block w-full px-3 py-2 rounded-xl border border-[var(--color-ink-200)] bg-white text-[14px] text-ink-900 placeholder:text-ink-400 focus:border-[var(--color-brand-500)] transition resize-none"
          />
          {dangerHint && (
            <div role="alert" className="mt-1.5 inline-flex items-center gap-1 text-[11px] text-[var(--color-warning-700)]">
              <AlertTriangle className="size-3" aria-hidden />
              {dangerHint}
            </div>
          )}
          <div className="mt-2 flex items-center justify-between gap-2">
            <div className="text-[11px] text-ink-500 [color:var(--color-ink-500)] inline-flex items-center gap-2">
              {aiAssisted && (
                <span className="inline-flex items-center gap-1 text-[var(--color-brand-700)]">
                  <Sparkles className="size-3" aria-hidden />
                  AI 下書きを編集中
                </span>
              )}
            </div>
            <Button type="button" disabled={!content.trim()} onClick={startQueue}>
              <Send className="size-4" aria-hidden />
              送信する
            </Button>
          </div>
        </div>
      )}

    </div>
  );
}
