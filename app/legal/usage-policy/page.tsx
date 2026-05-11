import {
  ShieldCheck,
  AlertTriangle,
  Lock,
  Sparkles,
  Clock,
  FileText,
} from "lucide-react";
import { Logo } from "@/components/brand/logo";

export const metadata = { title: "利用上の注意" };

export default function UsagePolicyPage() {
  return (
    <div className="hydro-canvas min-h-screen">
      <header className="border-b border-[var(--color-ink-100)] bg-white/85 backdrop-blur-md">
        <div className="max-w-[880px] mx-auto px-6 py-5 flex items-center justify-between">
          <Logo />
          <a
            href="/dashboard"
            className="text-[12px] text-ink-500 [color:var(--color-ink-500)] hover:text-ink-900 underline-offset-4 hover:underline"
          >
            ダッシュボードへ戻る
          </a>
        </div>
      </header>

      <main className="max-w-[880px] mx-auto px-6 py-12 space-y-10">
        <header>
          <div className="inline-flex items-center gap-2 mb-3 text-[11px] font-medium tracking-[0.18em] uppercase text-[var(--color-brand-700)]">
            <FileText className="size-3.5" aria-hidden />
            Usage Policy · 利用上の注意
          </div>
          <h1 className="font-display text-[36px] lg:text-[48px] font-bold tracking-tight text-ink-900 [color:var(--color-ink-900)] leading-[1.1]">
            安全に、丁寧に、送り出すために
          </h1>
          <p className="mt-4 text-[14px] text-ink-600 [color:var(--color-ink-600)] leading-relaxed max-w-[640px]">
            本サービスを使う上で、LinkedIn 利用規約と個人情報保護法 / GDPR
            への配慮、AI 生成メッセージの取り扱い、安全モードの動きを必ずご確認ください。
          </p>
        </header>

        <Section icon={ShieldCheck} title="LinkedIn 利用規約への配慮">
          <ul className="list-disc pl-5 space-y-2">
            <li>
              本サービスは Unipile API 経由で LinkedIn を操作します。お客様の LinkedIn アカウントの状態は、LinkedIn の Member Conduct Policy に従って利用される必要があります。
            </li>
            <li>
              新規アカウントは <strong>14 日間のウォームアップ期間</strong> として自動で日次上限を 1/3 → 2/3 → 100% に段階的に解放します。これは LinkedIn からの警告 / アカウント停止リスクを下げるためです。
            </li>
            <li>
              <strong>失敗連続 5 回</strong>、または短時間に LinkedIn からの警告サインを検知した場合、自動的に「安全モード」に切り替わり全送信を停止します (Phase2 監視ジョブで自動化予定)。
            </li>
          </ul>
        </Section>

        <Section icon={Lock} title="個人情報保護法 / GDPR">
          <ul className="list-disc pl-5 space-y-2">
            <li>
              リード / 会話 / ナレッジを含む全データは、お客様の組織 (テナント) 内に厳密に分離されます。
            </li>
            <li>
              EU 顧客のリードを扱う場合は、別途データ処理契約 (DPA) を締結のうえ EU リージョンでの DB 保管をご利用ください (Scale プラン)。
            </li>
            <li>
              データ削除 / エクスポートのリクエストは <code className="font-mono px-1 py-0.5 bg-[var(--color-ink-100)] rounded">/settings/data</code> から実行できます (30 日 grace 後に物理削除)。
            </li>
          </ul>
        </Section>

        <Section icon={Sparkles} title="AI 生成メッセージの取り扱い">
          <ul className="list-disc pl-5 space-y-2">
            <li>
              AI ドラフトは <strong>送信前のレビュー必須</strong> をデフォルトとします。自動送信モードへの昇格には Owner の同意と 2FA 再認証が必要です。
            </li>
            <li>
              送信前に <strong>機微情報 (電話番号 / メールアドレス / 価格・値引き表現)</strong> を検知し、Manager 以上の承認が必要な場合があります。
            </li>
            <li>
              AI が生成した文面の最終責任は、送信者にあります。送信前に必ず内容を確認してください。
            </li>
          </ul>
        </Section>

        <Section icon={Clock} title="レート制御 / 一次応答 SLA">
          <ul className="list-disc pl-5 space-y-2">
            <li>
              アカウント単位で <strong>1 日 25-50 件 / 週 100 件程度</strong> を上限とします (LinkedIn 推奨水準)。
            </li>
            <li>
              受信箱の一次応答 SLA は <strong>2 時間 (営業時間 9-18 平日)</strong>。超過すると赤フラグが立ち、未対応プールに昇格します。
            </li>
          </ul>
        </Section>

        <Section icon={AlertTriangle} title="禁止事項">
          <ul className="list-disc pl-5 space-y-2">
            <li>
              スパム / 一斉同文配信 / 個人情報の不正取得 / 競合サービスへの引き抜き目的の利用は禁止します。
            </li>
            <li>
              本サービスを使った活動の責任は、お客様にあります。LinkedIn からの C&D レター等が届いた場合は、すみやかにサポート (<a href="mailto:support@linkdinside.example" className="text-[var(--color-brand-700)] hover:underline">support@linkdinside.example</a>) までご連絡ください。
            </li>
          </ul>
        </Section>

        <footer className="pt-8 mt-8 border-t border-[var(--color-ink-100)] text-[11px] text-ink-500 [color:var(--color-ink-500)] leading-relaxed">
          最終更新:{" "}
          <span className="tabular font-mono">
            {new Intl.DateTimeFormat("ja-JP", {
              timeZone: "Asia/Tokyo",
              year: "numeric",
              month: "long",
              day: "numeric",
            }).format(new Date())}
          </span>
          {" / "}
          DPO 連絡先:{" "}
          <a href="mailto:dpo@linkdinside.example" className="text-[var(--color-brand-700)] hover:underline">
            dpo@linkdinside.example
          </a>
          {" / "}
          関連: <a href="/legal/dpa" className="text-[var(--color-brand-700)] hover:underline">DPA</a>{" "}
          ·{" "}
          <a href="/status" className="text-[var(--color-brand-700)] hover:underline">ステータス</a>
        </footer>
      </main>
    </div>
  );
}

function Section({
  icon: Icon,
  title,
  children,
}: {
  icon: typeof ShieldCheck;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="card-solid p-6 lg:p-7 space-y-3">
      <h2 className="font-display text-[18px] font-bold tracking-tight text-ink-900 [color:var(--color-ink-900)] inline-flex items-center gap-2">
        <span className="size-8 rounded-lg bg-[var(--color-brand-50)] border border-[var(--color-brand-200)] text-[var(--color-brand-700)] grid place-content-center">
          <Icon className="size-4" aria-hidden />
        </span>
        {title}
      </h2>
      <div className="text-[13px] text-ink-700 [color:var(--color-ink-700)] leading-relaxed">
        {children}
      </div>
    </section>
  );
}
