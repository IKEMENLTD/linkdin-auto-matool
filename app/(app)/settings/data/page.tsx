import {
  Download,
  Trash2,
  Database,
  Cloud,
  FileText,
  Webhook,
  AlertOctagon,
  Shield,
} from "lucide-react";
import { Header } from "@/components/app/header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/card";

export const metadata = { title: "データ管理" };

export default function DataManagementPage() {
  return (
    <>
      <Header title="データ管理" subtitle="エクスポート / 削除リクエスト" />

      <div className="px-4 sm:px-6 lg:px-10 py-6 lg:py-8 space-y-5 max-w-[1080px]">
        <div role="status" className="flex items-center gap-2 text-[12px] text-ink-500 [color:var(--color-ink-500)]">
          <Badge tone="info">Phase2</Badge>
          実行フローは Phase2 で実装します。本ページは設計書 §17.2 / §17.6 / §6.11 S20 に基づく仕様の可視化。
        </div>

        <div>
          <h2 className="font-display text-[26px] lg:text-[32px] font-bold tracking-tight text-ink-900 [color:var(--color-ink-900)]">
            データのエクスポート / 削除
          </h2>
          <p className="text-[12px] text-ink-500 [color:var(--color-ink-500)] mt-1">
            GDPR Art.17 / 個人情報保護法 28 条 (DSAR) 対応 · リージョン分離 JP / EU
          </p>
        </div>

        {/* エクスポート */}
        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <Download className="size-4 text-[var(--color-brand-600)]" aria-hidden />
              <CardTitle>データのエクスポート</CardTitle>
            </div>
            <Badge tone="neutral">Phase2</Badge>
          </CardHeader>
          <CardBody className="space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-[13px]">
              <Field label="形式">
                <div className="flex gap-2">
                  <Pill active>JSON</Pill>
                  <Pill>CSV</Pill>
                </div>
              </Field>
              <Field label="範囲">
                <div className="flex gap-2">
                  <Pill active>全期間</Pill>
                  <Pill>過去 90 日</Pill>
                </div>
              </Field>
            </div>
            <p className="text-[11px] text-ink-500 [color:var(--color-ink-500)] leading-relaxed">
              実行時は <strong>目的の記録 (必須)</strong> + 件数プレビュー + 2FA 再認証 + ダウンロード URL 7 日失効。各行に hidden 透かし <code className="font-mono text-[10px] px-1 py-0.5 bg-[var(--color-ink-100)] rounded">__watermark</code> が付与され、<a href="/audit/exports" className="text-[var(--color-brand-700)] hover:underline">エクスポート履歴</a> から撤回可能 (Phase2)。
            </p>
            <div>
              <Button disabled title="Phase2 で実装予定">
                <Download className="size-4" aria-hidden />
                エクスポートをリクエスト (Phase2)
              </Button>
            </div>
          </CardBody>
        </Card>

        {/* 削除 */}
        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <Trash2 className="size-4 text-[var(--color-danger-700)]" aria-hidden />
              <CardTitle>データの削除リクエスト</CardTitle>
            </div>
            <Badge tone="neutral">Phase2</Badge>
          </CardHeader>
          <CardBody className="space-y-4">
            <div className="space-y-2">
              <p className="text-[12px] text-ink-600 [color:var(--color-ink-600)] leading-relaxed">
                対象 (チェックされたデータを 30 日 grace 後に物理削除):
              </p>
              <ScopeRow icon={Database} label="リード" estimate="即時削除" />
              <ScopeRow icon={Cloud} label="会話 / メッセージ" estimate="即時削除" />
              <ScopeRow icon={FileText} label="ナレッジ / 埋め込みベクトル" estimate="即時削除 (再計算不可)" />
              <ScopeRow icon={Webhook} label="外部連携の残存データ (HubSpot / Salesforce / Webhook 受信先)" estimate="撤回 API 案内のみ (相手側保有)" />
              <ScopeRow icon={Shield} label="LLM プロバイダログ (Anthropic ZDR)" estimate="30 日で完全削除" />
            </div>
            <div className="rounded-xl border border-[#FECACA] bg-[var(--color-danger-50)]/40 px-3.5 py-2.5 text-[12px] text-[var(--color-danger-700)] leading-relaxed">
              <strong>監査ログは保持期間 (90 日 / Enterprise 13ヶ月) 中は削除不可</strong>です (設計書 §17 改竄耐性)。
              保持期間経過後のアーカイブ削除は Owner 4-eye 承認が必要です。
            </div>
            <p className="text-[11px] text-ink-500 [color:var(--color-ink-500)] leading-relaxed">
              実行時は <code className="font-mono text-[10px] px-1 py-0.5 bg-[var(--color-ink-100)] rounded">DELETE</code> と入力 + 2FA 再認証 + 確認メール + 30 日 grace。
              削除完了予測日と進捗をメール通知します。
            </p>
            <div>
              <Button disabled variant="danger" title="Phase2 で実装予定">
                <Trash2 className="size-4" aria-hidden />
                削除リクエストを送信 (Phase2)
              </Button>
            </div>
          </CardBody>
        </Card>

        {/* リージョン */}
        <Card>
          <CardHeader>
            <CardTitle>データ保管リージョン</CardTitle>
            <Badge tone="brand">JP (現在)</Badge>
          </CardHeader>
          <CardBody className="text-[12px] text-ink-700 [color:var(--color-ink-700)] leading-relaxed">
            現在のリージョン: <strong>Asia Northeast 1 (Tokyo)</strong>。EU 顧客のリードを扱う場合は DPA 締結 + EU リージョン切替 (Scale プラン)。
            切替時は同意ダイアログ + 既存データの再配置プランが表示されます (Phase2)。
          </CardBody>
        </Card>
      </div>
    </>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-[11px] font-medium text-ink-500 [color:var(--color-ink-500)] mb-1">{label}</div>
      {children}
    </div>
  );
}

function Pill({ children, active }: { children: React.ReactNode; active?: boolean }) {
  return (
    <span
      className={
        active
          ? "inline-flex items-center rounded-full px-3 py-1 text-[12px] border border-[var(--color-brand-500)] bg-[var(--color-brand-50)] text-[var(--color-brand-700)] font-medium"
          : "inline-flex items-center rounded-full px-3 py-1 text-[12px] border border-[var(--color-ink-200)] bg-white text-ink-500 [color:var(--color-ink-500)]"
      }
    >
      {children}
    </span>
  );
}

function ScopeRow({
  icon: Icon,
  label,
  estimate,
}: {
  icon: typeof Database;
  label: string;
  estimate: string;
}) {
  // Phase2 で実装する削除フォームのプレビュー (現状は読み取り専用)
  return (
    <div className="flex items-center gap-3 px-3.5 py-2.5 rounded-xl border border-[var(--color-ink-200)] bg-white">
      <span
        aria-hidden
        className="inline-flex size-[18px] items-center justify-center rounded-[5px] border border-[var(--color-brand-300)] bg-[var(--color-brand-50)] text-[var(--color-brand-700)]"
      >
        <svg viewBox="0 0 12 12" className="size-3" aria-hidden>
          <path d="M2 6.5l2.5 2.5L10 3.5" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </span>
      <Icon className="size-3.5 text-ink-500 [color:var(--color-ink-500)]" aria-hidden />
      <span className="flex-1 text-[13px] text-ink-900 [color:var(--color-ink-900)]">{label}</span>
      <span className="text-[10px] tabular font-mono text-ink-400 [color:var(--color-ink-400)]">
        {estimate}
      </span>
    </div>
  );
}
