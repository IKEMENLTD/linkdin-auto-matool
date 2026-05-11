import Link from "next/link";
import {
  Sparkles,
  Check,
  ArrowRight,
  Building2,
  Users,
  Plug,
  Target,
  ShieldCheck,
  Rocket,
} from "lucide-react";
import { Logo } from "@/components/brand/logo";
import { Button } from "@/components/ui/button";

export const metadata = { title: "ようこそ" };

export default async function OnboardingPage({
  searchParams,
}: {
  searchParams: Promise<{ step?: string }>;
}) {
  const sp = await searchParams;
  const step = Math.min(5, Math.max(1, Number(sp.step) || 1));

  return (
    <div className="hydro-canvas min-h-screen">
      <header className="border-b border-[var(--color-ink-100)] bg-white/85 backdrop-blur-md">
        <div className="max-w-[880px] mx-auto px-6 py-5 flex items-center justify-between">
          <Logo />
          <Link
            href="/dashboard"
            className="text-[12px] text-ink-500 [color:var(--color-ink-500)] hover:text-ink-900 underline-offset-4 hover:underline"
          >
            スキップして始める
          </Link>
        </div>
      </header>

      <main className="max-w-[880px] mx-auto px-6 py-12 space-y-8">
        <header>
          <div className="inline-flex items-center gap-2 mb-3 text-[11px] font-medium tracking-[0.18em] uppercase text-[var(--color-brand-700)]">
            <Sparkles className="size-3.5" aria-hidden />
            ようこそ
          </div>
          <h1 className="font-display text-[36px] lg:text-[48px] font-bold tracking-tight text-ink-900 [color:var(--color-ink-900)] leading-[1.1]">
            10 分で「最初の発見」まで
            <br />
            <span className="text-[var(--color-brand-600)]">セットアップしましょう</span>
          </h1>
          <p className="mt-4 text-[14px] text-ink-600 [color:var(--color-ink-600)] leading-relaxed max-w-[640px]">
            設計書 §5.1 に基づくオンボーディング 5 ステップ。完了率の目標は 70% / 中央値 9 分 / 初回キャンペーンは「未送信ドラフト」で停止する安全側の設計です。
          </p>
        </header>

        <ol className="space-y-3">
          <StepCard
            n={1}
            icon={Building2}
            title="ワークスペースの作成"
            description="会社名・業種・規模を入力。Stripe 連携 (請求担当) は Phase2。"
            done={step > 1}
          />
          <StepCard
            n={2}
            icon={Users}
            title="メンバーの招待"
            description="Operator / Manager / Admin を招待。Phase2 で SSO IDP 連携 + Idle Timeout。"
            done={step > 2}
          />
          <StepCard
            n={3}
            icon={Plug}
            title="LinkedIn アカウント接続"
            description="Unipile OAuth でアカウントを 1 つ接続 (Phase2 で UI フロー実装、現状は DB 投入)。"
            done={step > 3}
          />
          <StepCard
            n={4}
            icon={Target}
            title="ICP ヒアリング (3 問)"
            description="①ターゲット役職 ②業界 ③従業員規模。AI が検索式とメッセージ雛形を提案します。"
            done={step > 4}
          />
          <StepCard
            n={5}
            icon={Rocket}
            title="最初のキャンペーン (Draft)"
            description="送信モードは既定で「レビュー必須」。最初の 10 リードを未送信でプレビューできます。"
            done={step > 5}
          />
        </ol>

        <section className="card-solid p-6 lg:p-8 flex items-start gap-4">
          <span className="size-10 rounded-xl bg-[var(--color-brand-50)] border border-[var(--color-brand-200)] text-[var(--color-brand-700)] grid place-content-center">
            <ShieldCheck className="size-4" aria-hidden />
          </span>
          <div className="flex-1">
            <h3 className="font-display text-[15px] font-semibold tracking-tight text-ink-900 [color:var(--color-ink-900)]">
              安全側の既定
            </h3>
            <p className="mt-1 text-[12px] text-ink-600 [color:var(--color-ink-600)] leading-relaxed">
              ・初回キャンペーンは Draft 保存のみ、自動送信は行いません
              <br />
              ・新規 LinkedIn アカウントは 14 日間のウォームアップ (日次上限 8 → 17 → 25 件)
              <br />
              ・送信前レビュー必須。AI ドラフトは「編集 / 採用しない / 根拠を見る」の 3 操作。
            </p>
          </div>
        </section>

        <div className="flex items-center justify-between pt-4">
          <span className="text-[11px] tabular font-mono text-ink-500 [color:var(--color-ink-500)]">
            Step {step} / 5
          </span>
          <Link href="/campaigns/new">
            <Button>
              キャンペーン作成へ進む
              <ArrowRight className="size-4" aria-hidden />
            </Button>
          </Link>
        </div>
      </main>
    </div>
  );
}

function StepCard({
  n,
  icon: Icon,
  title,
  description,
  done,
}: {
  n: number;
  icon: typeof Building2;
  title: string;
  description: string;
  done: boolean;
}) {
  return (
    <li className="card-solid p-5 flex items-start gap-4">
      <span
        aria-hidden
        className={
          done
            ? "size-10 rounded-xl bg-[var(--color-success-50)] border border-[#A7F3D0] text-[var(--color-success-700)] grid place-content-center shrink-0"
            : "size-10 rounded-xl bg-[var(--color-brand-50)] border border-[var(--color-brand-200)] text-[var(--color-brand-700)] grid place-content-center shrink-0"
        }
      >
        {done ? <Check className="size-4" aria-hidden /> : <Icon className="size-4" aria-hidden />}
      </span>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="size-5 rounded-full bg-[var(--color-brand-500)] text-white text-[10px] font-bold grid place-content-center tabular">
            {n}
          </span>
          <h3 className="font-display text-[15px] font-semibold tracking-tight text-ink-900 [color:var(--color-ink-900)]">
            {title}
          </h3>
        </div>
        <p className="mt-1 text-[12px] text-ink-600 [color:var(--color-ink-600)] leading-relaxed">
          {description}
        </p>
      </div>
    </li>
  );
}
