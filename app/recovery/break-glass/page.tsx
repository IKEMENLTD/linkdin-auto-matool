import {
  ShieldAlert,
  Mail,
  KeyRound,
  ScanFace,
  Clock,
  CheckCircle2,
} from "lucide-react";
import { Logo } from "@/components/brand/logo";

export const metadata = { title: "Break-Glass · 緊急復旧" };

export default function BreakGlassPage() {
  return (
    <div className="hydro-canvas min-h-screen">
      <header className="border-b border-[var(--color-ink-100)] bg-white/85 backdrop-blur-md">
        <div className="max-w-[760px] mx-auto px-6 py-5 flex items-center justify-between">
          <Logo />
          <a
            href="/login"
            className="text-[12px] text-ink-500 [color:var(--color-ink-500)] hover:text-ink-900 underline-offset-4 hover:underline"
          >
            サインインに戻る
          </a>
        </div>
      </header>

      <main className="max-w-[760px] mx-auto px-6 py-12 space-y-8">
        <header>
          <div className="inline-flex items-center gap-2 mb-3 text-[11px] font-medium tracking-[0.18em] uppercase text-[var(--color-danger-700)]">
            <ShieldAlert className="size-3.5" aria-hidden />
            Break-Glass · 災害復旧
          </div>
          <h1 className="font-display text-[36px] lg:text-[42px] font-bold tracking-tight text-ink-900 [color:var(--color-ink-900)] leading-[1.1]">
            SSO ロックアウト時の緊急アクセス
          </h1>
          <p className="mt-4 text-[14px] text-ink-600 [color:var(--color-ink-600)] leading-relaxed">
            通常時の操作は <a href="/settings/security" className="text-[var(--color-brand-700)] hover:underline">/settings/security</a> から行ってください。
            本フローは SSO IDP 障害 / Owner 不在の災害時のみ使用します。すべての操作は監査ログに <code className="font-mono px-1 py-0.5 bg-[var(--color-ink-100)] rounded text-[11px]">BREAK_GLASS</code> フラグで記録されます。
          </p>
        </header>

        <ol className="space-y-3">
          <Step
            n={1}
            icon={Mail}
            title="登録メールアドレスへの認証コード送信"
            description="Owner として登録されたメールアドレスに 6 桁の認証コードをお送りします。"
          />
          <Step
            n={2}
            icon={KeyRound}
            title="バックアップコード入力"
            description="初回サインアップ時にダウンロードした 8 桁リカバリコードを入力します。"
            warning="失敗 5 回で 24 時間ロック / 全 Owner にメール通知"
          />
          <Step
            n={3}
            icon={ScanFace}
            title="本人確認 (KYC)"
            description="マイナンバーカード / パスポート / 運転免許のいずれかの画像 + 顔写真 (ライブネス検証) をアップロード。"
            warning="Owner / Admin 別人による 4-eye 承認 (代理者なら 24 時間待機)"
          />
          <Step
            n={4}
            icon={Clock}
            title="24 時間の緊急 Admin 昇格"
            description="承認後、24 時間だけ Admin 相当の権限が付与されます。SSO IDP の再設定後は通常 RBAC に復帰します。"
            warning="操作は監査ログに BREAK_GLASS フラグ付きで残り、Owner 全員にメール通知"
          />
        </ol>

        <section className="card-solid p-6 border-[#FECACA] bg-[var(--color-danger-50)]/40">
          <div className="flex items-start gap-3">
            <span className="size-9 rounded-xl bg-[var(--color-danger-100)]/50 border border-[#FECACA] text-[var(--color-danger-700)] grid place-content-center">
              <ShieldAlert className="size-4" aria-hidden />
            </span>
            <div className="flex-1">
              <h2 className="font-display text-[14px] font-bold tracking-tight text-[var(--color-danger-700)]">
                Phase2 で実装予定
              </h2>
              <p className="mt-1 text-[12px] text-ink-700 [color:var(--color-ink-700)] leading-relaxed">
                Break-Glass フローの実機実装は Phase2 で対応します。本ページは設計書 §5.9 / §6.11.8 に基づく仕様の可視化を目的としています。
                緊急時は <a href="mailto:support@linkdinside.example" className="text-[var(--color-brand-700)] hover:underline">support@linkdinside.example</a> までご連絡ください (24 時間以内に CSM 担当より折り返します)。
              </p>
            </div>
          </div>
        </section>

        <section aria-labelledby="session-info" className="text-[11px] text-ink-500 [color:var(--color-ink-500)] leading-relaxed text-center pt-4">
          <p>
            このページは Idle Timeout 5 分 / SSL 必須 / IP 履歴監視を適用します (設計書 §17)。
          </p>
        </section>
      </main>
    </div>
  );
}

function Step({
  n,
  icon: Icon,
  title,
  description,
  warning,
}: {
  n: number;
  icon: typeof Mail;
  title: string;
  description: string;
  warning?: string;
}) {
  return (
    <li className="card-solid p-5 flex items-start gap-4">
      <span
        aria-hidden
        className="size-10 rounded-xl border border-[var(--color-brand-200)] bg-[var(--color-brand-50)] text-[var(--color-brand-700)] grid place-content-center shrink-0"
      >
        <Icon className="size-4" aria-hidden />
      </span>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-1">
          <span className="size-5 rounded-full bg-[var(--color-brand-500)] text-white text-[10px] font-bold grid place-content-center tabular">
            {n}
          </span>
          <h3 className="font-display text-[15px] font-semibold tracking-tight text-ink-900 [color:var(--color-ink-900)]">
            {title}
          </h3>
        </div>
        <p className="text-[12px] text-ink-600 [color:var(--color-ink-600)] leading-relaxed">{description}</p>
        {warning && (
          <p className="mt-2 text-[11px] text-[var(--color-warning-700)] inline-flex items-start gap-1">
            <CheckCircle2 className="size-3 mt-0.5 shrink-0" aria-hidden />
            {warning}
          </p>
        )}
      </div>
    </li>
  );
}
