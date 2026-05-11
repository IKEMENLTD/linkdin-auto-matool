import { notFound } from "next/navigation";
import { Header } from "@/components/app/header";
import { Badge } from "@/components/ui/badge";
import { DetailHeader } from "@/components/campaigns/detail/detail-header";
import { DetailTabs, type DetailTab } from "@/components/campaigns/detail/detail-tabs";
import { TabOverview } from "@/components/campaigns/detail/tab-overview";
import { TabLeads } from "@/components/campaigns/detail/tab-leads";
import { TabMessages } from "@/components/campaigns/detail/tab-messages";
import { TabSettings } from "@/components/campaigns/detail/tab-settings";
import { getSession } from "@/lib/auth";
import { getCampaignDetail } from "@/server/queries/campaign-detail";
import { AlertOctagon } from "lucide-react";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

const ALLOWED_TABS = new Set<DetailTab>(["overview", "leads", "messages", "settings"]);

const STRICT_UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MOCK_PREFIXES = ["c", "00000000"] as const;

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return { title: `キャンペーン #${id.slice(0, 6)}` };
}

export default async function CampaignDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ tab?: string }>;
}) {
  const { id } = await params;
  const { tab: rawTab } = await searchParams;

  // パスが UUID 形式でなければ 404
  // (mock id ("c1" 等) は dev / DB 未接続時のみ許容して DB 不正アクセスを回避)
  const isDev = process.env.NODE_ENV !== "production";
  const isReasonable =
    STRICT_UUID_RE.test(id) ||
    (isDev && MOCK_PREFIXES.some((p) => id.startsWith(p)));
  if (!isReasonable) {
    notFound();
  }

  const tab: DetailTab = (ALLOWED_TABS.has(rawTab as DetailTab) ? rawTab : "overview") as DetailTab;

  const session = await getSession();
  const result = await getCampaignDetail(session?.orgId ?? null, id);

  if (!result.ok) {
    if (result.reason === "not_found") notFound();
    return (
      <>
        <Header title="キャンペーン詳細" subtitle="一時的な問題が発生しています" />
        <div className="px-6 lg:px-10 py-8">
          <div
            role="alert"
            className="flex items-start gap-2.5 text-[13px] rounded-2xl border border-[#FECACA] bg-[var(--color-danger-50)] text-[var(--color-danger-700)] px-4 py-3"
          >
            <AlertOctagon className="size-4 mt-0.5 shrink-0" aria-hidden />
            <div className="leading-relaxed">
              キャンペーン情報を取得できませんでした。時間をおいて再度お試しください。
              {result.incidentId && (
                <>
                  {" "}
                  サポートへの連絡時は{" "}
                  <code className="font-mono tabular text-[11px] px-1.5 py-0.5 rounded bg-white border border-[#FECACA]">
                    {result.incidentId}
                  </code>{" "}
                  をお伝えください。
                </>
              )}
            </div>
          </div>
        </div>
      </>
    );
  }

  const { detail, source } = result;

  return (
    <>
      <Header title="キャンペーン詳細" subtitle={detail.name} as="p" />
      <div className="px-4 sm:px-6 lg:px-10 py-6 lg:py-8 space-y-6">
        {source === "mock" && (
          <div
            role="status"
            className="flex items-center gap-2 text-[12px] text-ink-500 [color:var(--color-ink-500)]"
          >
            <Badge tone="info">DEMO</Badge>
            DB 未接続のためサンプルのキャンペーンを表示しています。
          </div>
        )}

        <DetailHeader
          id={detail.id}
          name={detail.name}
          status={detail.status}
          hitlState={detail.hitlState}
          ownerName={detail.ownerName}
          startsAt={detail.startsAt}
        />

        <DetailTabs current={tab} campaignId={detail.id} />

        <div role="tabpanel" id={`tab-${tab}`} aria-labelledby={`tablabel-${tab}`}>
          {tab === "overview" && <TabOverview detail={detail} />}
          {tab === "leads" && <TabLeads detail={detail} />}
          {tab === "messages" && <TabMessages detail={detail} />}
          {tab === "settings" && <TabSettings detail={detail} />}
        </div>
      </div>
    </>
  );
}
