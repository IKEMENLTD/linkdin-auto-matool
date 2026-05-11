import Link from "next/link";
import { notFound } from "next/navigation";
import {
  ChevronLeft,
  Building2,
  Briefcase,
  Calendar,
  Target,
  ExternalLink,
  AlertOctagon,
} from "lucide-react";
import { Header } from "@/components/app/header";
import { StateChip } from "@/components/ui/state-chip";
import { Badge } from "@/components/ui/badge";
import { getSession } from "@/lib/auth";
import { getLeadById } from "@/server/queries/leads";
import { fmtRelative } from "@/lib/formatters";
import { safeExternalUrl } from "@/lib/utils";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

const STRICT_UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return { title: `リード #${id.slice(0, 6)}` };
}

export default async function LeadDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const isDev = process.env.NODE_ENV !== "production";
  if (!STRICT_UUID_RE.test(id) && !(isDev && id.startsWith("l"))) {
    notFound();
  }

  const session = await getSession();
  const lead = await getLeadById(session?.orgId ?? null, id);
  if (!lead) notFound();

  const linkedinUrl = safeExternalUrl(`https://www.linkedin.com/in/${lead.id}`); // demo

  return (
    <>
      <Header title="リード詳細" subtitle={lead.name} as="p" />

      <div className="px-4 sm:px-6 lg:px-10 py-6 lg:py-8 space-y-6 max-w-[1080px]">
        <Link
          href="/leads"
          className="inline-flex items-center gap-1 text-[12px] text-ink-500 [color:var(--color-ink-500)] hover:text-ink-900 underline-offset-4 hover:underline"
        >
          <ChevronLeft className="size-3.5" aria-hidden />
          リード一覧へ戻る
        </Link>

        {/* ヘッダ */}
        <header className="flex items-start justify-between flex-wrap gap-4">
          <div className="min-w-0">
            <h1 className="font-display text-[28px] lg:text-[36px] font-bold tracking-tight text-ink-900 [color:var(--color-ink-900)] leading-[1.1]">
              {lead.name}
            </h1>
            <p className="mt-2 text-[13px] text-ink-600 [color:var(--color-ink-600)] inline-flex items-center flex-wrap gap-2">
              {lead.headline && (
                <>
                  <Briefcase className="size-3.5 text-[var(--color-brand-600)]" aria-hidden />
                  {lead.headline}
                </>
              )}
              {lead.company && (
                <>
                  <Building2 className="size-3.5 text-[var(--color-brand-600)]" aria-hidden />
                  {lead.company}
                </>
              )}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <StateChip state={lead.state} size="md" />
            <Badge tone="brand">スコア {lead.score}</Badge>
            {linkedinUrl && (
              <a
                href={linkedinUrl}
                target="_blank"
                rel="noreferrer noopener"
                className="inline-flex items-center gap-1 text-[12px] text-[var(--color-brand-700)] hover:underline"
              >
                LinkedIn <ExternalLink className="size-3" aria-hidden />
              </a>
            )}
          </div>
        </header>

        {/* メタ情報 */}
        <section className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <MetaCard icon={Target} label="キャンペーン">
            {lead.campaignName ? (
              <Link
                href={`/campaigns/${lead.campaignId}`}
                className="text-[var(--color-brand-700)] hover:underline truncate inline-flex items-center gap-1"
              >
                {lead.campaignName}
                <ExternalLink className="size-3" aria-hidden />
              </Link>
            ) : (
              <Muted>—</Muted>
            )}
          </MetaCard>
          <MetaCard icon={Calendar} label="最終アクション">
            {lead.lastActionAt ? (
              <span className="tabular font-mono">{fmtRelative(lead.lastActionAt)}</span>
            ) : (
              <Muted>未開始</Muted>
            )}
          </MetaCard>
          <MetaCard icon={Briefcase} label="担当">
            {lead.ownerName ?? <Muted>未割り当て</Muted>}
          </MetaCard>
        </section>

        {/* タイムライン (Phase2) */}
        <section className="card-solid p-5">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-[11px] font-bold tracking-[0.18em] uppercase text-ink-500 [color:var(--color-ink-500)]">
              タイムライン
            </h2>
            <Badge tone="info">Phase2</Badge>
          </div>
          <div className="rounded-xl border border-dashed border-[var(--color-ink-200)] bg-[var(--color-ink-50)]/40 px-4 py-8 text-center">
            <AlertOctagon className="size-5 text-ink-400 [color:var(--color-ink-400)] mx-auto mb-2" aria-hidden />
            <p className="text-[12px] text-ink-500 [color:var(--color-ink-500)] leading-relaxed">
              ENRICHED / QUALIFIED / PENDING / CONNECTED / MESSAGED / REPLIED の
              <br />
              タイムラインは Phase2 で実装予定 (設計書 §6.11.3)
            </p>
            <Link
              href={`/inbox/${lead.id}`}
              className="mt-3 inline-flex items-center gap-1 text-[12px] text-[var(--color-brand-700)] hover:underline"
            >
              現在の会話を見る <ExternalLink className="size-3" aria-hidden />
            </Link>
          </div>
        </section>

        {/* CRM (Phase2) */}
        <section className="card-solid p-5">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-[11px] font-bold tracking-[0.18em] uppercase text-ink-500 [color:var(--color-ink-500)]">
              CRM 状態
            </h2>
            <Badge tone="info">Phase2</Badge>
          </div>
          <p className="text-[12px] text-ink-500 [color:var(--color-ink-500)] leading-relaxed">
            HubSpot / Salesforce / Pipedrive 連携は Phase2 で実装します (設計書 §6.6)。
            商談化時に CRM へ Deal を自動作成する設計です。
          </p>
        </section>
      </div>
    </>
  );
}

function MetaCard({
  icon: Icon,
  label,
  children,
}: {
  icon: typeof Building2;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="card-solid p-4">
      <div className="text-[11px] font-medium tracking-[0.16em] uppercase text-ink-500 [color:var(--color-ink-500)] inline-flex items-center gap-1.5">
        <Icon className="size-3 text-[var(--color-brand-600)]" aria-hidden />
        {label}
      </div>
      <div className="mt-2 text-[13.5px] text-ink-900 [color:var(--color-ink-900)] font-medium truncate">
        {children}
      </div>
    </div>
  );
}

function Muted({ children }: { children: React.ReactNode }) {
  return <span className="text-ink-400 [color:var(--color-ink-400)] font-normal">{children}</span>;
}
