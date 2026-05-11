import Link from "next/link";
import { notFound } from "next/navigation";
import { AlertOctagon, ChevronLeft } from "lucide-react";
import { Header } from "@/components/app/header";
import { Badge } from "@/components/ui/badge";
import { ConversationView } from "@/components/inbox/conversation-view";
import { getSession } from "@/lib/auth";
import { getConversation } from "@/server/queries/conversation";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

const STRICT_UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MOCK_PREFIXES = ["l", "00000000"];

export async function generateMetadata({
  params,
}: {
  params: Promise<{ leadId: string }>;
}) {
  const { leadId } = await params;
  return { title: `スレッド #${leadId.slice(0, 6)}` };
}

export default async function ConversationPage({
  params,
}: {
  params: Promise<{ leadId: string }>;
}) {
  const { leadId } = await params;

  const isDev = process.env.NODE_ENV !== "production";
  const valid =
    STRICT_UUID_RE.test(leadId) || (isDev && MOCK_PREFIXES.some((p) => leadId.startsWith(p)));
  if (!valid) notFound();

  const session = await getSession();
  const result = await getConversation(session?.orgId ?? null, leadId);

  if (!result.ok) {
    if (result.reason === "not_found") notFound();
    return (
      <>
        <Header title="会話" subtitle="一時的な問題が発生しています" as="p" />
        <div className="px-6 lg:px-10 py-8">
          <div
            role="alert"
            className="flex items-start gap-2.5 text-[13px] rounded-2xl border border-[#FECACA] bg-[var(--color-danger-50)] text-[var(--color-danger-700)] px-4 py-3"
          >
            <AlertOctagon className="size-4 mt-0.5 shrink-0" aria-hidden />
            <div className="leading-relaxed">
              会話を取得できませんでした。時間をおいて再度お試しください。
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
      <Header title="会話" subtitle={detail.lead.name} as="p" />
      <div className="px-3 sm:px-4 lg:px-6 pt-3 lg:pt-4 pb-0 flex items-center justify-between gap-3">
        <Link
          href="/inbox"
          className="inline-flex items-center gap-1 text-[12px] text-ink-500 [color:var(--color-ink-500)] hover:text-ink-900 underline-offset-4 hover:underline"
        >
          <ChevronLeft className="size-3.5" aria-hidden />
          受信箱へ戻る
        </Link>
        {source === "mock" && (
          <Badge tone="info">
            DEMO · DB 未接続 (送信は永続化されません)
          </Badge>
        )}
      </div>
      <ConversationView detail={detail} />
    </>
  );
}
