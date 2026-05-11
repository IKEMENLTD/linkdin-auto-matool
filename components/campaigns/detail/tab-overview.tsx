import { KpiCard } from "@/components/dashboard/kpi-card";
import { Funnel } from "@/components/dashboard/funnel";
import { AttentionList } from "@/components/dashboard/attention-list";
import { ActivityChart } from "@/components/dashboard/activity-chart";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { LineChart } from "lucide-react";
import type { CampaignDetail } from "@/server/queries/campaign-detail";

export function TabOverview({ detail }: { detail: CampaignDetail }) {
  const hasDaily = detail.daily.some((d) => d.sent > 0 || d.replied > 0 || d.meeting > 0);

  return (
    <div className="space-y-6">
      <section aria-label="主要 KPI" className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <KpiCard
          label="送信数"
          current={detail.kpis.sent.current}
          previous={detail.kpis.sent.previous}
          hint="期間: 直近 30 日"
        />
        <KpiCard
          label="承認率"
          current={detail.kpis.approvalRate.current}
          previous={detail.kpis.approvalRate.previous}
          unit="percent"
          hint="CONNECTED / PENDING"
        />
        <KpiCard
          label="返信率"
          current={detail.kpis.replyRate.current}
          previous={detail.kpis.replyRate.previous}
          unit="percent"
          hint="REPLIED / MESSAGED"
        />
        <KpiCard
          label="商談化数"
          current={detail.kpis.meetings.current}
          previous={detail.kpis.meetings.previous}
          hint="期間合計"
        />
      </section>

      <section className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2">
          <Funnel
            steps={detail.funnel.map((f) => ({ state: f.state, label: f.label, count: f.count }))}
          />
        </div>
        <AttentionList items={detail.attention} />
      </section>

      <section>
        {hasDaily ? (
          <ActivityChart data={detail.daily} />
        ) : (
          <Card>
            <CardHeader>
              <div>
                <CardTitle>日次活動量</CardTitle>
                <div className="text-[11px] text-ink-500 [color:var(--color-ink-500)] mt-0.5">
                  送信 / 返信 / 商談化
                </div>
              </div>
              <Badge tone="info">集計準備中 · Phase2</Badge>
            </CardHeader>
            <CardBody>
              <div className="flex flex-col items-center justify-center py-12 text-center">
                <div className="size-12 rounded-2xl border border-[var(--color-brand-200)] bg-[var(--color-brand-50)] grid place-content-center text-[var(--color-brand-700)] mb-3">
                  <LineChart className="size-5" aria-hidden />
                </div>
                <div className="text-[13px] font-medium text-ink-900 [color:var(--color-ink-900)] mb-1">
                  キャンペーン別の日次集計はまだ準備中です
                </div>
                <div className="text-[12px] text-ink-500 [color:var(--color-ink-500)] max-w-[420px] leading-relaxed">
                  Phase2 で messages.sentAt を集計してチャートを表示します。それまではダッシュボードの全体活動量を参照してください。
                </div>
              </div>
            </CardBody>
          </Card>
        )}
      </section>
    </div>
  );
}
