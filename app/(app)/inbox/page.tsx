import { AlertOctagon, MessagesSquare } from "lucide-react";
import { Header } from "@/components/app/header";
import { Badge } from "@/components/ui/badge";
import { Pagination } from "@/components/ui/pagination";
import { InboxFilterTabs } from "@/components/inbox/inbox-filter-tabs";
import { InboxThreadList } from "@/components/inbox/inbox-thread-list";
import { getSession } from "@/lib/auth";
import { clamp } from "@/lib/utils";
import { listInboxThreads, type ThreadFilter } from "@/server/queries/inbox";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";
export const metadata = { title: "受信箱" };

const ALLOWED_FILTERS = new Set<ThreadFilter>(["all", "unread", "review", "meeting"]);

export default async function InboxPage({
  searchParams,
}: {
  searchParams: Promise<{ filter?: string; q?: string; page?: string }>;
}) {
  const sp = await searchParams;
  const filter = (ALLOWED_FILTERS.has(sp.filter as ThreadFilter)
    ? (sp.filter as ThreadFilter)
    : "all");
  const q = (sp.q ?? "").slice(0, 120);
  const page = clamp(Math.floor(Number(sp.page) || 1), 1, 1000);
  const perPage = 30;

  const session = await getSession();
  const { threads, total, counts, source, incidentId } = await listInboxThreads({
    orgId: session?.orgId ?? null,
    filter,
    q,
    page,
    perPage,
  });

  const hrefFor = (p: number) => {
    const params = new URLSearchParams();
    if (filter !== "all") params.set("filter", filter);
    if (q) params.set("q", q);
    if (p > 1) params.set("page", String(p));
    return params.size ? `/inbox?${params.toString()}` : "/inbox";
  };

  const hasSlaBreached = threads.some((t) => t.slaBreached);

  return (
    <>
      <Header
        title="受信箱"
        subtitle={
          total > 0
            ? `${total} 件の会話${hasSlaBreached ? " · 未対応 SLA 超過あり" : ""}`
            : "新しい会話が届くとここに表示されます"
        }
      />

      <div className="px-4 sm:px-6 lg:px-10 py-6 lg:py-8 space-y-5">
        {source === "mock" && (
          <div
            role="status"
            className="flex items-center gap-2 text-[12px] text-ink-500 [color:var(--color-ink-500)]"
          >
            <Badge tone="info">DEMO</Badge>
            DB 未接続のためサンプルの会話を表示しています。
          </div>
        )}

        {source === "degraded" && (
          <div
            role="alert"
            className="flex items-start gap-2.5 text-[12px] rounded-xl border border-[#FECACA] bg-[var(--color-danger-50)] text-[var(--color-danger-700)] px-3 py-2.5"
          >
            <AlertOctagon className="size-4 mt-0.5 shrink-0" aria-hidden />
            <div className="leading-relaxed">
              受信箱の取得中に問題が発生しました。時間をおいて再度お試しください。
              {incidentId && (
                <>
                  {" "}
                  サポートへの連絡時は{" "}
                  <code className="font-mono tabular text-[11px] px-1.5 py-0.5 rounded bg-white border border-[#FECACA]">
                    {incidentId}
                  </code>{" "}
                  をお伝えください。
                </>
              )}
            </div>
          </div>
        )}

        <div>
          <h2 className="font-display text-[26px] lg:text-[32px] font-bold tracking-tight text-ink-900 [color:var(--color-ink-900)]">
            受信箱
          </h2>
          <p className="text-[12px] text-ink-500 [color:var(--color-ink-500)] mt-1 inline-flex items-center gap-2">
            <MessagesSquare className="size-3.5 text-[var(--color-brand-600)]" aria-hidden />
            SLA: 一次応答 2 時間 (営業時間内) · 設計書 §25.3
          </p>
        </div>

        <InboxFilterTabs current={filter} counts={counts} />

        <InboxThreadList threads={threads} />

        {total > perPage && (
          <Pagination page={page} perPage={perPage} total={total} hrefFor={hrefFor} />
        )}
      </div>
    </>
  );
}
