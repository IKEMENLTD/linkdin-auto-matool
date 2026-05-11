import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { Header } from "@/components/app/header";
import { WizardShell } from "@/components/campaigns/wizard/wizard-shell";
import { Badge } from "@/components/ui/badge";
import { getSession } from "@/lib/auth";
import { listLinkedinAccounts } from "@/server/queries/accounts";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

export const metadata = { title: "キャンペーン作成" };

export default async function NewCampaignPage() {
  const session = await getSession();
  const accounts = await listLinkedinAccounts(session?.orgId ?? null);
  return (
    <>
      <Header title="キャンペーン作成" subtitle="5 ステップ ウィザード" />
      <div className="px-4 sm:px-6 lg:px-10 py-6 lg:py-8 space-y-6 max-w-[1280px]">
        <div className="flex items-center justify-between gap-3">
          <Link
            href="/campaigns"
            className="inline-flex items-center gap-1 text-[12px] text-ink-500 [color:var(--color-ink-500)] hover:text-ink-900 underline-offset-4 hover:underline"
          >
            <ChevronLeft className="size-3.5" aria-hidden />
            キャンペーン一覧へ戻る
          </Link>
          {!session && (
            <Badge tone="info" className="shrink-0">
              DEMO · 未ログインのため、下書きはローカル保存のみ
            </Badge>
          )}
        </div>

        <WizardShell accounts={accounts} authenticated={!!session} />
      </div>
    </>
  );
}
