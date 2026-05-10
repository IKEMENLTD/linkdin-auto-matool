import { Suspense } from "react";
import { Header } from "@/components/app/header";
import { NsmHero } from "@/components/dashboard/nsm-hero";
import { KpiCard } from "@/components/dashboard/kpi-card";
import { Funnel } from "@/components/dashboard/funnel";
import { AttentionList } from "@/components/dashboard/attention-list";
import { ActivityChart } from "@/components/dashboard/activity-chart";
import { RecentCampaigns } from "@/components/dashboard/recent-campaigns";
import { Skeleton } from "@/components/ui/skeleton";
import { getDashboardSnapshot } from "@/server/queries/dashboard";
import { Badge } from "@/components/ui/badge";
import { getSession } from "@/lib/auth";

/**
 * ダッシュボードはユーザー固有 (org_id / role / ABAC) のため
 * static cache はできない。Phase2 で短期 (60s) の Cache を per-org tag で導入予定。
 */
export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ range?: string }>;
}) {
  const { range } = await searchParams;
  const days = Math.min(180, Math.max(7, Number(range) || 30));

  const session = await getSession();
  const snapshot = await getDashboardSnapshot(session?.orgId ?? null, days);

  return (
    <>
      <Header
        title="ダッシュボード"
        subtitle={`${formatJST(snapshot.range.from)} 〜 ${formatJST(snapshot.range.to)} · ${snapshot.range.days} 日`}
      />

      <div className="px-6 lg:px-10 py-8 lg:py-10 space-y-8">
        {snapshot.source === "mock" && (
          <div
            role="status"
            className="flex items-center gap-2 text-[12px] text-ink-500 [color:var(--color-ink-500)]"
          >
            <Badge tone="info">DEMO</Badge>
            DB 未接続のため、サンプルデータを表示しています。`.env.local` に `DATABASE_URL` と Supabase キーを設定すると本データに切り替わります。
          </div>
        )}

        <Suspense fallback={<HeroSkeleton />}>
          <NsmHero
            weeklyReplies={snapshot.nsm.weeklyReplies}
            prevWeeklyReplies={snapshot.nsm.prevWeeklyReplies}
            activeAccounts={snapshot.nsm.activeAccounts}
            target={snapshot.nsm.target}
          />
        </Suspense>

        <section aria-label="主要 KPI" className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <KpiCard
            label="送信数"
            current={snapshot.kpis.sent.current}
            previous={snapshot.kpis.sent.previous}
            spark={snapshot.kpis.sent.spark}
            hint="期間合計 · 全アカウント"
            href="/campaigns"
          />
          <KpiCard
            label="承認率"
            current={snapshot.kpis.approvalRate.current}
            previous={snapshot.kpis.approvalRate.previous}
            unit="percent"
            spark={snapshot.kpis.approvalRate.spark}
            hint="CONNECTED / PENDING"
          />
          <KpiCard
            label="返信率"
            current={snapshot.kpis.replyRate.current}
            previous={snapshot.kpis.replyRate.previous}
            unit="percent"
            spark={snapshot.kpis.replyRate.spark}
            hint="REPLIED / MESSAGED"
            href="/inbox"
          />
          <KpiCard
            label="商談化数"
            current={snapshot.kpis.meetings.current}
            previous={snapshot.kpis.meetings.previous}
            spark={snapshot.kpis.meetings.spark}
            hint="期間合計"
            href="/leads?state=MEETING"
          />
        </section>

        <section className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <div className="lg:col-span-2">
            <Funnel steps={snapshot.funnel} />
          </div>
          <AttentionList items={snapshot.attention} />
        </section>

        <section className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <div className="lg:col-span-2">
            <ActivityChart data={snapshot.daily} />
          </div>
          <div className="lg:col-span-1 space-y-4">
            <RecentCampaigns rows={snapshot.recent.slice(0, 5)} />
          </div>
        </section>
      </div>
    </>
  );
}

const JST_FORMAT = new Intl.DateTimeFormat("ja-JP", {
  timeZone: "Asia/Tokyo",
  month: "long",
  day: "numeric",
});
function formatJST(iso: string) {
  return JST_FORMAT.format(new Date(iso));
}

function HeroSkeleton() {
  return (
    <div className="rounded-[var(--radius-2xl)] border border-[var(--color-ink-100)] p-8">
      <Skeleton className="h-3 w-32 mb-4" />
      <Skeleton className="h-20 w-2/3" />
    </div>
  );
}
