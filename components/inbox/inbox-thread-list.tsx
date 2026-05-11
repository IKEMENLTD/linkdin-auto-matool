import Link from "next/link";
import { AlertTriangle, ArrowDownLeft, ArrowUpRight, MessageSquare, ChevronRight } from "lucide-react";
import { StateChip } from "@/components/ui/state-chip";
import { EmptyState } from "@/components/ui/empty-state";
import { fmtRelative } from "@/lib/formatters";
import type { InboxThread } from "@/server/queries/inbox";
import { cn } from "@/lib/utils";

interface Props {
  threads: InboxThread[];
}

export function InboxThreadList({ threads }: Props) {
  if (threads.length === 0) {
    return (
      <EmptyState
        icon={MessageSquare}
        title="該当する会話がありません"
        description="フィルタを切り替えるか、しばらくお待ちください。新しい返信は自動で受信箱に届きます。"
        primary={{ label: "ダッシュボードへ戻る", href: "/dashboard" }}
      />
    );
  }

  // SLA 超過 / 通常を 1 パスで分離してから個別 sort
  const slaBreachedItems: InboxThread[] = [];
  const normalItems: InboxThread[] = [];
  for (const t of threads) {
    (t.slaBreached ? slaBreachedItems : normalItems).push(t);
  }
  const byTime = (a: InboxThread, b: InboxThread) => {
    const at = a.lastMessageAt ? new Date(a.lastMessageAt).getTime() : 0;
    const bt = b.lastMessageAt ? new Date(b.lastMessageAt).getTime() : 0;
    return bt - at;
  };
  slaBreachedItems.sort(byTime);
  normalItems.sort(byTime);

  return (
    <div className="space-y-6">
      {slaBreachedItems.length > 0 && (
        <ThreadSection
          title="未対応 SLA 超過"
          tone="danger"
          icon={AlertTriangle}
          items={slaBreachedItems}
          subtitle="受信から 2 時間を経過した返信があります"
        />
      )}
      <ThreadSection
        title={slaBreachedItems.length > 0 ? "通常" : "新着順"}
        tone="neutral"
        items={normalItems}
      />
    </div>
  );
}

function ThreadSection({
  title,
  subtitle,
  tone,
  icon: Icon,
  items,
}: {
  title: string;
  subtitle?: string;
  tone: "neutral" | "danger";
  icon?: React.ComponentType<{ className?: string; "aria-hidden"?: boolean }>;
  items: InboxThread[];
}) {
  if (items.length === 0) return null;
  return (
    <section>
      <div className="flex items-center gap-2 mb-2.5 px-1">
        {Icon && (
          <Icon
            className={cn(
              "size-3.5",
              tone === "danger" ? "text-[var(--color-danger-700)]" : "text-ink-500 [color:var(--color-ink-500)]"
            )}
            aria-hidden
          />
        )}
        <h2
          className={cn(
            "text-[11px] font-bold tracking-[0.18em] uppercase",
            tone === "danger" ? "text-[var(--color-danger-700)]" : "text-ink-500 [color:var(--color-ink-500)]"
          )}
        >
          {title}
        </h2>
        {subtitle && (
          <span className="text-[11px] text-ink-500 [color:var(--color-ink-500)]">
            · {subtitle}
          </span>
        )}
        <span className="ml-auto text-[10px] tabular font-mono text-ink-400 [color:var(--color-ink-400)]">
          {items.length} 件
        </span>
      </div>
      <ul className={cn(
        "card-solid overflow-hidden divide-y divide-[var(--color-ink-100)]",
        tone === "danger" && "border-[#FECACA]"
      )}>
        {items.map((t) => (
          <li key={t.leadId}>
            <ThreadRow thread={t} />
          </li>
        ))}
      </ul>
    </section>
  );
}

function ThreadRow({ thread }: { thread: InboxThread }) {
  return (
    <Link
      href={`/inbox/${thread.leadId}`}
      aria-label={`${thread.leadName} のスレッド · 状態 ${thread.state} · スコア ${thread.score}${thread.slaBreached ? " · SLA 超過" : ""}`}
      className={cn(
        "grid grid-cols-1 md:grid-cols-[1.5fr_120px_56px_minmax(180px,2.4fr)_120px_24px] gap-3 items-center px-4 py-3.5 hover:bg-[var(--color-brand-50)]/60 transition relative",
        thread.slaBreached && "bg-[var(--color-danger-50)]/30 hover:bg-[var(--color-danger-50)]/50"
      )}
    >
      {thread.slaBreached && (
        <span
          aria-hidden
          className="absolute inset-y-0 left-0 w-[3px] bg-[var(--color-danger-500)]"
        />
      )}
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <span className="font-display text-[14px] font-semibold tracking-tight text-ink-900 [color:var(--color-ink-900)] truncate">
            {thread.leadName}
          </span>
          {thread.requiresReview && !thread.slaBreached && (
            <span
              className="inline-flex items-center text-[10px] font-bold rounded-full bg-[var(--color-brand-500)] text-white px-1.5 py-0.5"
              aria-label="要レビュー"
            >
              NEW
            </span>
          )}
        </div>
        <div className="text-[11px] text-ink-500 [color:var(--color-ink-500)] truncate">
          {[thread.leadHeadline, thread.leadCompany].filter(Boolean).join(" · ") || "—"}
        </div>
        <div className="md:hidden mt-1 flex items-center flex-wrap gap-2">
          <StateChip state={thread.state} />
          <span className="tabular font-mono text-[11px] font-semibold text-[var(--color-brand-700)]">
            スコア {thread.score}
          </span>
        </div>
      </div>

      <div className="hidden md:flex items-center">
        <StateChip state={thread.state} />
      </div>

      <div className="hidden md:block text-right">
        <span
          className="tabular font-mono text-[12px] font-semibold text-[var(--color-brand-700)]"
          aria-label={`スコア ${thread.score}`}
        >
          {thread.score}
        </span>
      </div>

      <div className="min-w-0 text-[12px] flex items-start gap-2">
        {thread.lastDirection && (
          <span
            aria-hidden
            className={cn(
              "shrink-0 size-5 grid place-content-center rounded-full border mt-0.5",
              thread.lastDirection === "inbound"
                ? "border-[var(--color-brand-300)] bg-[var(--color-brand-50)] text-[var(--color-brand-700)]"
                : "border-[var(--color-ink-200)] bg-white text-ink-400 [color:var(--color-ink-400)]"
            )}
          >
            {thread.lastDirection === "inbound" ? (
              <ArrowDownLeft className="size-3" />
            ) : (
              <ArrowUpRight className="size-3" />
            )}
          </span>
        )}
        <div className="min-w-0">
          <div className="text-ink-700 [color:var(--color-ink-700)] truncate">
            {thread.lastMessageSnippet ?? "(まだメッセージがありません)"}
          </div>
          <div className="text-[10px] tabular font-mono text-ink-400 [color:var(--color-ink-400)] mt-0.5">
            {thread.lastMessageAt ? fmtRelative(thread.lastMessageAt) : "—"}
            {thread.slaBreached && (
              <span className="ml-2 inline-flex items-center gap-0.5 text-[var(--color-danger-700)] font-semibold">
                <AlertTriangle className="size-2.5" aria-hidden />
                SLA 超過
              </span>
            )}
          </div>
        </div>
      </div>

      <div className="hidden md:block text-[11px] text-ink-500 [color:var(--color-ink-500)] truncate text-right">
        <div className="truncate">{thread.campaignName ?? "—"}</div>
        <div className="text-[10px] text-ink-400 [color:var(--color-ink-400)] truncate">
          {thread.ownerName ?? "—"}
        </div>
      </div>

      <ChevronRight
        className="hidden md:block size-4 text-ink-300 [color:var(--color-ink-300)]"
        aria-hidden
      />
    </Link>
  );
}
