import {
  Shield,
  Key,
  Globe2,
  Clock,
  ScrollText,
  ExternalLink,
  Smartphone,
} from "lucide-react";
import { Header } from "@/components/app/header";
import { Badge } from "@/components/ui/badge";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/card";

export const dynamic = "force-dynamic";
export const metadata = { title: "セキュリティ" };

export default function SecurityPage() {
  return (
    <>
      <Header title="セキュリティ" subtitle="SSO / IP / 監査 / リージョン" />

      <div className="px-4 sm:px-6 lg:px-10 py-6 lg:py-8 space-y-5 max-w-[1080px]">
        <div role="status" className="flex items-center gap-2 text-[12px] text-ink-500 [color:var(--color-ink-500)]">
          <Badge tone="info">Phase2</Badge>
          以下の設定は Phase2 で実装予定です。現状は設計書 §17 / §26 に基づく可視化を提供します。
        </div>

        <div>
          <h2 className="font-display text-[26px] lg:text-[32px] font-bold tracking-tight text-ink-900 [color:var(--color-ink-900)]">
            セキュリティ設定
          </h2>
          <p className="text-[12px] text-ink-500 [color:var(--color-ink-500)] mt-1">
            設計書 §17 (ABAC / 監査 / マスキング) + §26 (脅威モデル 7 件)
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <FeatureCard
            icon={Key}
            title="SSO (SAML / OIDC)"
            description="Okta / Microsoft Entra ID / Google Workspace。SCIM プロビジョニング対応予定。"
            stage="Phase2 (Scale プラン)"
          />
          <FeatureCard
            icon={Smartphone}
            title="二要素認証 (MFA)"
            description="TOTP / WebAuthn / バックアップコード。Owner はロール強制可。"
            stage="Phase2"
          />
          <FeatureCard
            icon={Globe2}
            title="IP 制限 / CIDR 許可リスト"
            description="社内 IP のみ閲覧可。Enterprise は CIDR 5 グループまで。"
            stage="Phase2 (Enterprise)"
          />
          <FeatureCard
            icon={Clock}
            title="Idle Timeout"
            description="一般 30 分 / Manager 15 分 / Owner 10 分 / Break-Glass 5 分。タイムアウト前に警告。"
            stage="Phase2"
          />
          <FeatureCard
            icon={Globe2}
            title="データ保管リージョン (JP / EU)"
            description="顧客単位でリージョン固定。越境表示時は同意ダイアログ。"
            stage="Phase2 (Scale プラン)"
          />
          <FeatureCard
            icon={ScrollText}
            title="監査ログ (13ヶ月)"
            description="hash chain + WORM 保管。標準 90 日 / Enterprise 13ヶ月。"
            stage="実装済 (90 日)"
            done
            href="/audit"
          />
        </div>

        <Card>
          <CardHeader>
            <CardTitle>セキュリティイベント (直近 90 日)</CardTitle>
            <Badge tone="info">Phase2</Badge>
          </CardHeader>
          <CardBody className="text-[12px] text-ink-500 [color:var(--color-ink-500)] leading-relaxed">
            ログイン失敗連続 / 新規 IP からのログイン / API キー再生成 / 権限昇格 /
            Break-Glass 使用 / DLP ヒット — のタイムラインを Phase2 で表示します
            (設計書 §26.3)。
          </CardBody>
        </Card>

        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <Shield className="size-4 text-[var(--color-brand-600)]" aria-hidden />
              <CardTitle>脅威モデル (設計書 §26)</CardTitle>
            </div>
          </CardHeader>
          <CardBody className="text-[12px] text-ink-700 [color:var(--color-ink-700)] space-y-2 leading-relaxed">
            <ThreatRow n={1} label="退職者持ち出し (Insider Exfiltration)" />
            <ThreatRow n={2} label="Indirect Prompt Injection (LLM01:2025)" />
            <ThreatRow n={3} label="テナントロックアウト (SSO/Owner 不在)" />
            <ThreatRow n={4} label="越境データ移転 / 同意撤回" />
            <ThreatRow n={5} label="AI 自動送信暴走 (Automated Mass-Misfire)" />
            <ThreatRow n={6} label="OAuth トークン漏洩 / Unipile への中間者攻撃" />
            <ThreatRow n={7} label="AI Hallucination による誤情報送信" />
          </CardBody>
        </Card>
      </div>
    </>
  );
}

function FeatureCard({
  icon: Icon,
  title,
  description,
  stage,
  done,
  href,
}: {
  icon: typeof Shield;
  title: string;
  description: string;
  stage: string;
  done?: boolean;
  href?: string;
}) {
  const inner = (
    <Card className="hover:shadow-[var(--shadow-elevated)] transition-shadow">
      <CardBody className="p-5 space-y-2">
        <div className="flex items-start justify-between gap-2">
          <span className="size-9 rounded-xl bg-[var(--color-brand-50)] border border-[var(--color-brand-200)] text-[var(--color-brand-700)] grid place-content-center">
            <Icon className="size-4" aria-hidden />
          </span>
          {done ? <Badge tone="success">{stage}</Badge> : <Badge tone="neutral">{stage}</Badge>}
        </div>
        <h3 className="font-display text-[15px] font-semibold tracking-tight text-ink-900 [color:var(--color-ink-900)]">
          {title}
        </h3>
        <p className="text-[12px] text-ink-600 [color:var(--color-ink-600)] leading-relaxed">
          {description}
        </p>
      </CardBody>
    </Card>
  );
  if (href) {
    return (
      <a href={href} className="block">
        {inner}
      </a>
    );
  }
  return inner;
}

function ThreatRow({ n, label }: { n: number; label: string }) {
  return (
    <div className="flex items-center gap-2">
      <span className="size-5 rounded-full bg-[var(--color-brand-500)] text-white text-[10px] font-bold grid place-content-center tabular shrink-0">
        {n}
      </span>
      <span>{label}</span>
    </div>
  );
}
