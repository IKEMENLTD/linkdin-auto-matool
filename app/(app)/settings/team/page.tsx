import { AlertOctagon, Mail, Users } from "lucide-react";
import { Header } from "@/components/app/header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { MembersTable } from "@/components/settings/members-table";
import { getSession } from "@/lib/auth";
import { listMembers, ROLE_LABEL, ROLE_DESC } from "@/server/queries/members";
import type { Role } from "@/lib/auth";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";
export const metadata = { title: "メンバー / 権限" };

const ROLES: Role[] = ["owner", "admin", "manager", "operator", "viewer"];

export default async function TeamPage() {
  const session = await getSession();
  const result = await listMembers(session?.orgId ?? null);

  if (!result.ok) {
    return (
      <>
        <Header title="メンバー / 権限" subtitle="一時的な問題が発生しています" />
        <div className="px-6 lg:px-10 py-8">
          <div
            role="alert"
            className="flex items-start gap-2.5 text-[13px] rounded-2xl border border-[#FECACA] bg-[var(--color-danger-50)] text-[var(--color-danger-700)] px-4 py-3"
          >
            <AlertOctagon className="size-4 mt-0.5 shrink-0" aria-hidden />
            <div>
              メンバー情報の取得に失敗しました。
              <code className="ml-1 font-mono tabular text-[11px] px-1.5 py-0.5 rounded bg-white border border-[#FECACA]">
                {result.incidentId}
              </code>
            </div>
          </div>
        </div>
      </>
    );
  }

  const { members, source } = result;
  const activeCount = members.filter((m) => m.isActive).length;

  return (
    <>
      <Header
        title="メンバー / 権限"
        subtitle={`${activeCount} 名のアクティブメンバー · ${members.length - activeCount} 名が無効化済`}
      />

      <div className="px-4 sm:px-6 lg:px-10 py-6 lg:py-8 space-y-6 max-w-[1280px]">
        {source === "mock" && (
          <div role="status" className="flex items-center gap-2 text-[12px] text-ink-500 [color:var(--color-ink-500)]">
            <Badge tone="info">DEMO</Badge>
            DB 未接続のためサンプルメンバーを表示しています。
          </div>
        )}

        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="font-display text-[26px] lg:text-[32px] font-bold tracking-tight text-ink-900 [color:var(--color-ink-900)]">
              メンバーと権限
            </h2>
            <p className="text-[12px] text-ink-500 [color:var(--color-ink-500)] mt-1 inline-flex items-center gap-2">
              <Users className="size-3.5 text-[var(--color-brand-600)]" aria-hidden />
              Owner / Admin はメンバー招待・ロール変更が可能 (設計書 §6.9)
            </p>
          </div>
          <Button disabled title="Phase2 で実装予定">
            <Mail className="size-4" aria-hidden />
            招待を送る (Phase2)
          </Button>
        </div>

        <MembersTable
          members={members}
          currentUserId={session?.userId ?? null}
          currentRole={session?.role ?? null}
        />

        <section
          aria-labelledby="role-matrix"
          className="card-solid p-5"
        >
          <h3
            id="role-matrix"
            className="text-[11px] font-bold tracking-[0.18em] uppercase text-ink-500 [color:var(--color-ink-500)] mb-4"
          >
            ロール権限マトリクス
          </h3>
          <ul className="space-y-3">
            {ROLES.map((r) => (
              <li key={r} className="grid grid-cols-[100px_1fr] gap-3 items-start text-[13px]">
                <Badge tone="brand" className="self-start">{ROLE_LABEL[r]}</Badge>
                <span className="text-ink-700 [color:var(--color-ink-700)] leading-relaxed">
                  {ROLE_DESC[r]}
                </span>
              </li>
            ))}
          </ul>
          <p className="mt-4 text-[11px] text-ink-500 [color:var(--color-ink-500)] leading-relaxed">
            設計書 §6.9 / §17 ABAC: リード単位 / キャンペーン参加メンバー / タグ / リージョン属性は Phase2 で導入。
          </p>
        </section>
      </div>
    </>
  );
}
