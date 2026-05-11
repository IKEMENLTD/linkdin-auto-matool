import { AlertOctagon, Plug, Plus } from "lucide-react";
import { Header } from "@/components/app/header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { ConnectionsContainer } from "@/components/connections/connections-container";
import { getSession } from "@/lib/auth";
import { listLinkedinConnections } from "@/server/queries/connections";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";
export const metadata = { title: "LinkedIn 接続" };

export default async function ConnectionsLinkedinPage() {
  const session = await getSession();
  const result = await listLinkedinConnections(session?.orgId ?? null);

  if (!result.ok) {
    return (
      <>
        <Header title="LinkedIn 接続" subtitle="一時的な問題が発生しています" />
        <div className="px-6 lg:px-10 py-8">
          <div
            role="alert"
            className="flex items-start gap-2.5 text-[13px] rounded-2xl border border-[#FECACA] bg-[var(--color-danger-50)] text-[var(--color-danger-700)] px-4 py-3"
          >
            <AlertOctagon className="size-4 mt-0.5 shrink-0" aria-hidden />
            <div className="leading-relaxed">
              アカウント情報を取得できませんでした。時間をおいて再度お試しください。
              <code className="ml-1 font-mono tabular text-[11px] px-1.5 py-0.5 rounded bg-white border border-[#FECACA]">
                {result.incidentId}
              </code>
            </div>
          </div>
        </div>
      </>
    );
  }

  const { accounts, source } = result;
  const activeCount = accounts.filter((a) => a.status === "active").length;
  const warmingCount = accounts.filter((a) => a.status === "warming").length;
  const safeModeCount = accounts.filter((a) => a.status === "safe_mode").length;

  return (
    <>
      <Header
        title="LinkedIn 接続"
        subtitle={`${accounts.length} アカウント · アクティブ ${activeCount} / ウォームアップ ${warmingCount}${safeModeCount > 0 ? ` / 安全モード ${safeModeCount}` : ""}`}
      />

      <div className="px-4 sm:px-6 lg:px-10 py-6 lg:py-8 space-y-5 max-w-[1280px]">
        {source === "mock" && (
          <div
            role="status"
            className="flex items-center gap-2 text-[12px] text-ink-500 [color:var(--color-ink-500)]"
          >
            <Badge tone="info">DEMO</Badge>
            DB 未接続のためサンプルアカウントを表示しています。
          </div>
        )}

        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="font-display text-[26px] lg:text-[32px] font-bold tracking-tight text-ink-900 [color:var(--color-ink-900)]">
              LinkedIn アカウント
            </h2>
            <p className="text-[12px] text-ink-500 [color:var(--color-ink-500)] mt-1 inline-flex items-center gap-2">
              <Plug className="size-3.5 text-[var(--color-brand-600)]" aria-hidden />
              Unipile OAuth 経由 (Phase2) · ウォームアップ 14 日 · 安全モード自動切替は Phase2 監視ジョブで実装
            </p>
          </div>
          <Button disabled title="Phase2 で実装予定">
            <Plus className="size-4" aria-hidden />
            アカウントを追加 (Phase2)
          </Button>
        </div>

        {accounts.length === 0 ? (
          <EmptyState
            icon={Plug}
            title="まだ LinkedIn アカウントが接続されていません"
            description="Phase2 で Unipile OAuth 経由の接続を提供します。Phase1 では DB に手動投入したアカウントのみ表示されます。"
            primary={{ label: "利用上の注意", href: "/legal/usage-policy" }}
          />
        ) : (
          <ConnectionsContainer accounts={accounts} />
        )}
      </div>
    </>
  );
}
