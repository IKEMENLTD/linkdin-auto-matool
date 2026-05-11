import { Users, AlertOctagon } from "lucide-react";
import { Header } from "@/components/app/header";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { Pagination } from "@/components/ui/pagination";
import { LeadsFilterBar } from "@/components/leads/leads-filter-bar";
import { LeadsTable } from "@/components/leads/leads-table";
import { LeadDrawer } from "@/components/leads/lead-drawer";
import { getSession } from "@/lib/auth";
import { clamp } from "@/lib/utils";
import {
  getCampaignNamesForFilter,
  getLeadById,
  listLeads,
} from "@/server/queries/leads";
import { STATE_ORDER, type LeadState } from "@/lib/state-machine";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";
export const metadata = { title: "リード一覧" };

const ALLOWED_STATES = new Set<string>(["", ...STATE_ORDER]);

export default async function LeadsPage({
  searchParams,
}: {
  searchParams: Promise<{
    state?: string;
    campaign?: string;
    scoreMin?: string;
    q?: string;
    page?: string;
    lead?: string;
  }>;
}) {
  const sp = await searchParams;
  const state = ALLOWED_STATES.has(sp.state ?? "") ? ((sp.state ?? "") as LeadState | "") : "";
  const campaignId = sp.campaign ?? "";
  const q = (sp.q ?? "").slice(0, 120);
  const scoreMin = clamp(Math.floor(Number(sp.scoreMin) || 0), 0, 100);
  const page = clamp(Math.floor(Number(sp.page) || 1), 1, 2000);
  const perPage = 50;
  const drawerLeadId = sp.lead ?? "";

  const session = await getSession();
  const [{ items, total, source, incidentId }, campaigns, drawerLead] = await Promise.all([
    listLeads({
      orgId: session?.orgId ?? null,
      state,
      campaignId,
      q,
      scoreMin,
      page,
      perPage,
    }),
    getCampaignNamesForFilter(session?.orgId ?? null),
    drawerLeadId ? getLeadById(session?.orgId ?? null, drawerLeadId) : Promise.resolve(null),
  ]);

  const hrefFor = (p: number) => {
    const params = new URLSearchParams();
    if (state) params.set("state", state);
    if (campaignId) params.set("campaign", campaignId);
    if (q) params.set("q", q);
    if (scoreMin > 0) params.set("scoreMin", String(scoreMin));
    if (p > 1) params.set("page", String(p));
    return params.size ? `/leads?${params.toString()}` : "/leads";
  };

  return (
    <>
      <Header title="リード" subtitle={`${total} 件のリード`} />

      <div className="px-4 sm:px-6 lg:px-10 py-6 lg:py-8 space-y-5">
        {source === "mock" && (
          <div
            role="status"
            className="flex items-center gap-2 text-[12px] text-ink-500 [color:var(--color-ink-500)]"
          >
            <Badge tone="info">DEMO</Badge>
            DB 未接続のためサンプルのリードを表示しています。
          </div>
        )}

        {source === "degraded" && (
          <div
            role="alert"
            className="flex items-start gap-2.5 text-[12px] rounded-xl border border-[#FECACA] bg-[var(--color-danger-50)] text-[var(--color-danger-700)] px-3 py-2.5"
          >
            <AlertOctagon className="size-4 mt-0.5 shrink-0" aria-hidden />
            <div className="leading-relaxed">
              リード一覧の取得中に問題が発生しました。時間をおいて再読み込みしてください。
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
            リード一覧
          </h2>
          <p className="text-[12px] text-ink-500 [color:var(--color-ink-500)] mt-1">
            全キャンペーン横断 · 最終アクション降順 · スコアは AI 適合度
          </p>
        </div>

        <LeadsFilterBar campaigns={campaigns} />

        {items.length === 0 ? (
          q || state || campaignId || scoreMin > 0 ? (
            <EmptyState
              icon={Users}
              title="条件に一致するリードがありません"
              description="フィルタを緩めるか、別のキーワードでお試しください。"
              primary={{ label: "フィルタをクリア", href: "/leads" }}
            />
          ) : (
            <EmptyState
              icon={Users}
              title="まだリードがいません"
              description="キャンペーンを開始すると、24 時間以内に最初のリードが現れます。"
              primary={{ label: "キャンペーンを作成", href: "/campaigns/new" }}
              secondary={{ label: "ダッシュボード", href: "/dashboard" }}
            />
          )
        ) : (
          <>
            <LeadsTable rows={items} />
            <Pagination page={page} perPage={perPage} total={total} hrefFor={hrefFor} />
          </>
        )}
      </div>

      <LeadDrawer lead={drawerLead} open={!!drawerLeadId} />
    </>
  );
}
