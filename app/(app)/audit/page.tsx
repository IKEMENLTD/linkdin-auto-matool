import { AlertOctagon, ShieldCheck, ScrollText, Lock } from "lucide-react";
import { Header } from "@/components/app/header";
import { Badge } from "@/components/ui/badge";
import { Pagination } from "@/components/ui/pagination";
import { getSession, hasAtLeastRole } from "@/lib/auth";
import { listAuditLog } from "@/server/queries/audit";
import { clamp } from "@/lib/utils";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";
export const metadata = { title: "監査ログ" };

export default async function AuditPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string }>;
}) {
  const sp = await searchParams;
  const page = clamp(Math.floor(Number(sp.page) || 1), 1, 1000);
  const perPage = 50;

  const session = await getSession();
  if (session && !hasAtLeastRole(session.role, "admin")) {
    return (
      <>
        <Header title="監査ログ" subtitle="権限が不足しています" />
        <div className="px-6 lg:px-10 py-8">
          <div role="alert" className="flex items-start gap-2.5 text-[13px] rounded-2xl border border-[#FECACA] bg-[var(--color-danger-50)] text-[var(--color-danger-700)] px-4 py-3">
            <Lock className="size-4 mt-0.5 shrink-0" aria-hidden />
            監査ログの閲覧は Admin 以上の権限が必要です。
          </div>
        </div>
      </>
    );
  }

  const result = await listAuditLog(session?.orgId ?? null, page, perPage);
  if (!result.ok) {
    return (
      <>
        <Header title="監査ログ" subtitle="一時的な問題が発生しています" />
        <div className="px-6 lg:px-10 py-8">
          <div role="alert" className="flex items-start gap-2.5 text-[13px] rounded-2xl border border-[#FECACA] bg-[var(--color-danger-50)] text-[var(--color-danger-700)] px-4 py-3">
            <AlertOctagon className="size-4 mt-0.5 shrink-0" aria-hidden />
            <code className="font-mono tabular text-[11px] px-1.5 py-0.5 rounded bg-white border border-[#FECACA]">
              {result.incidentId}
            </code>
          </div>
        </div>
      </>
    );
  }

  const { entries, total, source, verifiedAt } = result;
  const hrefFor = (p: number) => (p > 1 ? `/audit?page=${p}` : "/audit");

  return (
    <>
      <Header title="監査ログ" subtitle={`${total} 件 · 改竄耐性: SHA-256 hash chain + 90 日保持`} />

      <div className="px-4 sm:px-6 lg:px-10 py-6 lg:py-8 space-y-5 max-w-[1280px]">
        {source === "mock" && (
          <div role="status" className="flex items-center gap-2 text-[12px] text-ink-500 [color:var(--color-ink-500)]">
            <Badge tone="info">DEMO</Badge>
            DB 未接続のためサンプル監査ログを表示しています。
          </div>
        )}

        <div className="flex items-end justify-between flex-wrap gap-3">
          <div>
            <h2 className="font-display text-[26px] lg:text-[32px] font-bold tracking-tight text-ink-900 [color:var(--color-ink-900)]">
              監査ログ
            </h2>
            <p className="text-[12px] text-ink-500 [color:var(--color-ink-500)] mt-1 inline-flex items-center gap-2">
              <ScrollText className="size-3.5 text-[var(--color-brand-600)]" aria-hidden />
              Append-only · 削除 / 編集ボタンなし (Owner も不可) · 訂正は打ち消しエントリで
            </p>
          </div>
          <div className="inline-flex items-center gap-2">
            <span className="text-[11px] tabular font-mono text-ink-500 [color:var(--color-ink-500)]">
              整合性検証:
            </span>
            {verifiedAt ? (
              <Badge tone="success">
                <ShieldCheck className="size-3" aria-hidden />
                ✓ 検証済 ({new Intl.DateTimeFormat("ja-JP", { timeZone: "Asia/Tokyo", month: "short", day: "numeric", hour: "2-digit" }).format(new Date(verifiedAt))})
              </Badge>
            ) : (
              <Badge tone="warning" title="日次検証ジョブは Phase2 で実装予定です">
                未検証 (Phase2)
              </Badge>
            )}
          </div>
        </div>

        <ul className="card-solid divide-y divide-[var(--color-ink-100)]">
          {entries.length === 0 ? (
            <li className="px-5 py-10 text-center text-[13px] text-ink-500 [color:var(--color-ink-500)]">
              監査ログがまだありません
            </li>
          ) : (
            entries.map((e) => (
              <li key={e.id} className="px-4 py-3 flex items-start gap-3">
                <span className="size-8 rounded-lg bg-[var(--color-brand-50)] border border-[var(--color-brand-200)] text-[var(--color-brand-700)] grid place-content-center text-[10px] font-bold shrink-0">
                  {e.actorName?.slice(0, 1) ?? "?"}
                </span>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center flex-wrap gap-2">
                    <span className="font-medium text-[13.5px] text-ink-900 [color:var(--color-ink-900)] truncate">
                      {e.actorName ?? "(不明)"}
                    </span>
                    <span className="text-[11px] text-ink-500 [color:var(--color-ink-500)]">
                      が
                    </span>
                    <Badge tone="brand">{e.action}</Badge>
                    {e.targetType && (
                      <span className="text-[11px] text-ink-500 [color:var(--color-ink-500)] font-mono tabular truncate">
                        {e.targetType}:{e.targetId?.slice(0, 8) ?? "?"}
                      </span>
                    )}
                  </div>
                  {e.purpose && (
                    <div className="mt-0.5 text-[12px] text-ink-700 [color:var(--color-ink-700)] truncate">
                      理由: {e.purpose}
                    </div>
                  )}
                  {e.diff && (
                    <div className="mt-1 text-[11px] text-ink-500 [color:var(--color-ink-500)] font-mono tabular truncate">
                      diff: {JSON.stringify(e.diff)}
                    </div>
                  )}
                  <div className="mt-1.5 flex items-center gap-3 text-[10px] tabular font-mono text-ink-400 [color:var(--color-ink-400)]">
                    <span>
                      {new Intl.DateTimeFormat("ja-JP", {
                        timeZone: "Asia/Tokyo",
                        month: "short",
                        day: "numeric",
                        hour: "2-digit",
                        minute: "2-digit",
                      }).format(new Date(e.createdAt))}
                    </span>
                    {e.fromIp && <span>IP: {e.fromIp}</span>}
                    {e.correlationId && <span>corr: {e.correlationId.slice(0, 8)}</span>}
                  </div>
                </div>
                <code
                  className="hidden sm:inline-flex shrink-0 text-[10px] tabular font-mono text-ink-400 [color:var(--color-ink-400)] truncate max-w-[140px]"
                  title={e.hash}
                >
                  #{e.hash.slice(0, 12)}
                </code>
              </li>
            ))
          )}
        </ul>

        {total > perPage && <Pagination page={page} perPage={perPage} total={total} hrefFor={hrefFor} />}
      </div>
    </>
  );
}
