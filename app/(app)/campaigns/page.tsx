import Link from "next/link";
import { Plus, Target, AlertOctagon } from "lucide-react";
import { clamp } from "@/lib/utils";
import { Header } from "@/components/app/header";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { Pagination } from "@/components/ui/pagination";
import { CampaignsFilterBar } from "@/components/campaigns/campaigns-filter-bar";
import { CampaignsTable } from "@/components/campaigns/campaigns-table";
import { getSession } from "@/lib/auth";
import { listCampaigns } from "@/server/queries/campaigns";
import type { CampaignStatus } from "@/lib/campaign-status";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

export const metadata = { title: "キャンペーン" };

const ALLOWED_STATUS = new Set(["", "draft", "running", "paused", "completed", "safe_mode"]);

export default async function CampaignsPage({
  searchParams,
}: {
  searchParams: Promise<{
    status?: string;
    owner?: string;
    q?: string;
    page?: string;
  }>;
}) {
  const sp = await searchParams;
  const status = ALLOWED_STATUS.has(sp.status ?? "")
    ? ((sp.status ?? "") as CampaignStatus | "")
    : ("" as const);
  const owner = sp.owner ?? "";
  const q = (sp.q ?? "").slice(0, 120);
  const page = clamp(Math.floor(Number(sp.page) || 1), 1, 1000);
  const perPage = 25;

  const session = await getSession();
  const { items, total, source, incidentId } = await listCampaigns({
    orgId: session?.orgId ?? null,
    status,
    ownerUserId: owner === "me" && session ? session.userId : "",
    q,
    page,
    perPage,
  });

  const hrefFor = (p: number) => {
    const params = new URLSearchParams();
    if (status) params.set("status", status);
    if (owner) params.set("owner", owner);
    if (q) params.set("q", q);
    if (p > 1) params.set("page", String(p));
    return params.size ? `/campaigns?${params.toString()}` : "/campaigns";
  };

  return (
    <>
      <Header
        title="キャンペーン"
        subtitle={`${total} 件のキャンペーン${status ? ` · 状態: ${status}` : ""}`}
      />

      <div className="px-4 sm:px-6 lg:px-10 py-6 lg:py-8 space-y-5">
        {source === "mock" && (
          <div
            role="status"
            className="flex items-center gap-2 text-[12px] text-ink-500 [color:var(--color-ink-500)]"
          >
            <Badge tone="info">DEMO</Badge>
            DB 未接続のためサンプルキャンペーンを表示しています。
          </div>
        )}

        {source === "degraded" && (
          <div
            role="alert"
            className="flex items-start gap-2.5 text-[12px] rounded-xl border border-[#FECACA] bg-[var(--color-danger-50)] text-[var(--color-danger-700)] px-3 py-2.5"
          >
            <AlertOctagon className="size-4 mt-0.5 shrink-0" aria-hidden />
            <div className="leading-relaxed">
              キャンペーン一覧の取得中に問題が発生しました。時間をおいて再読み込みしてください。
              {incidentId && (
                <>
                  {" "}
                  サポートへの連絡時は{" "}
                  <code className="font-mono tabular text-[11px] px-1.5 py-0.5 rounded bg-white border border-[#FECACA]">
                    {incidentId}
                  </code>
                  {" "}をお伝えください。
                </>
              )}
            </div>
          </div>
        )}

        <div className="flex items-center justify-between gap-3">
          <h2 className="font-display text-[26px] lg:text-[32px] font-bold tracking-tight text-ink-900 [color:var(--color-ink-900)]">
            キャンペーン一覧
          </h2>
          <Link href="/campaigns/new">
            <Button size="md">
              <Plus className="size-4" aria-hidden />
              新規作成
            </Button>
          </Link>
        </div>

        <CampaignsFilterBar />

        {items.length === 0 ? (
          q || status || owner ? (
            <EmptyState
              icon={Target}
              title="条件に一致するキャンペーンがありません"
              description="フィルタを緩めるか、別のキーワードでもう一度試してみてください。"
              primary={{ label: "フィルタをクリア", href: "/campaigns" }}
            />
          ) : (
            <EmptyState
              icon={Target}
              title="最初のキャンペーンを 5 ステップで作れます"
              description="製品 URL とターゲット ICP を入力するだけで、AI が ICP 検索式とメッセージ雛形を提案します。"
              primary={{ label: "キャンペーンを作成", href: "/campaigns/new" }}
              secondary={{ label: "作り方ガイド", href: "/legal/usage-policy" }}
            />
          )
        ) : (
          <>
            <CampaignsTable rows={items} />
            <Pagination page={page} perPage={perPage} total={total} hrefFor={hrefFor} />
          </>
        )}
      </div>
    </>
  );
}
