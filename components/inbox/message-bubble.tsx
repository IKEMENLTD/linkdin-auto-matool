import { Sparkles, Check, CheckCheck, AlertCircle, Loader2 } from "lucide-react";
import { fmtRelative } from "@/lib/formatters";
import { cn } from "@/lib/utils";

export type BubbleStatus = "sending" | "sent" | "delivered" | "failed";

interface Props {
  direction: "outbound" | "inbound";
  content: string;
  aiAssisted?: boolean;
  sentAt: string;
  status?: BubbleStatus;
  authorName?: string;
}

export function MessageBubble({
  direction,
  content,
  aiAssisted,
  sentAt,
  status = "delivered",
  authorName,
}: Props) {
  const isOutbound = direction === "outbound";

  return (
    <div
      className={cn(
        "flex flex-col gap-1.5 max-w-[78%]",
        isOutbound ? "items-end self-end" : "items-start self-start"
      )}
    >
      <div
        className={cn(
          "rounded-2xl px-4 py-2.5 text-[13.5px] leading-relaxed whitespace-pre-wrap break-words",
          isOutbound
            ? "bg-[linear-gradient(180deg,#38BDF8_0%,#0EA5E9_55%,#0284C7_100%)] text-white shadow-[0_8px_24px_-12px_rgba(14,165,233,0.55)] rounded-br-md"
            : "bg-white border border-[var(--color-ink-200)] text-ink-900 [color:var(--color-ink-900)] rounded-bl-md shadow-[var(--shadow-card)]"
        )}
      >
        {content}
      </div>
      <div
        className={cn(
          "flex items-center gap-1.5 text-[10px] tabular font-mono",
          isOutbound ? "text-ink-500 [color:var(--color-ink-500)]" : "text-ink-400 [color:var(--color-ink-400)]"
        )}
      >
        {authorName && (
          <>
            <span className="font-sans">{authorName}</span>
            <span aria-hidden>·</span>
          </>
        )}
        <time dateTime={sentAt}>{fmtRelative(sentAt)}</time>
        {isOutbound && aiAssisted && (
          <span
            className="inline-flex items-center gap-0.5 text-[var(--color-brand-600)]"
            aria-label="AI 補助あり"
          >
            <Sparkles className="size-2.5" aria-hidden />
            AI
          </span>
        )}
        {isOutbound && status && <StatusIcon status={status} />}
      </div>
    </div>
  );
}

function StatusIcon({ status }: { status: BubbleStatus }) {
  if (status === "sending")
    return (
      <span className="inline-flex items-center gap-0.5" aria-label="送信中">
        <Loader2 className="size-3 animate-spin" aria-hidden />
      </span>
    );
  if (status === "sent")
    return (
      <span className="inline-flex items-center gap-0.5" aria-label="送信済">
        <Check className="size-3" aria-hidden />
      </span>
    );
  if (status === "delivered")
    return (
      <span
        className="inline-flex items-center gap-0.5 text-[var(--color-brand-600)]"
        aria-label="配信済"
      >
        <CheckCheck className="size-3" aria-hidden />
      </span>
    );
  return (
    <span
      className="inline-flex items-center gap-0.5 text-[var(--color-danger-700)]"
      aria-label="送信失敗"
    >
      <AlertCircle className="size-3" aria-hidden />
    </span>
  );
}
