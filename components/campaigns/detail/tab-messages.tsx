import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Mail, Link2, FileText, Eye } from "lucide-react";
import type { CampaignDetail } from "@/server/queries/campaign-detail";

type MessageStep = {
  tone?: string;
  length?: string;
  connectMessage?: string;
  firstDm?: string;
  abEnabled?: boolean;
  abVariantB?: string;
};

const TONE_LABEL: Record<string, string> = {
  formal: "フォーマル",
  casual: "ややカジュアル",
  friendly: "親しみ重視",
};

export function TabMessages({ detail }: { detail: CampaignDetail }) {
  const message = (detail.productDocs?.message ?? {}) as MessageStep;
  const tone = message.tone ?? "formal";

  return (
    <div className="grid lg:grid-cols-2 gap-4">
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Link2 className="size-4 text-[var(--color-brand-600)]" aria-hidden />
            <CardTitle>コネクト申請</CardTitle>
          </div>
          <Badge tone="brand">{TONE_LABEL[tone] ?? tone}</Badge>
        </CardHeader>
        <CardBody>
          <MessageBlock body={message.connectMessage} placeholder="(設定されていません — 300 字以内)" maxLen={300} />
        </CardBody>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Mail className="size-4 text-[var(--color-brand-600)]" aria-hidden />
            <CardTitle>初回 DM</CardTitle>
          </div>
          <div className="flex items-center gap-2">
            {message.abEnabled && <Badge tone="info">A/B 有効</Badge>}
            <Badge tone="brand">{TONE_LABEL[tone] ?? tone}</Badge>
          </div>
        </CardHeader>
        <CardBody>
          <MessageBlock body={message.firstDm} placeholder="(初回 DM が設定されていません)" maxLen={1500} />
        </CardBody>
      </Card>

      {message.abEnabled && (
        <Card className="lg:col-span-2">
          <CardHeader>
            <div className="flex items-center gap-2">
              <FileText className="size-4 text-[var(--color-brand-600)]" aria-hidden />
              <CardTitle>A/B 案 B</CardTitle>
            </div>
            <Badge tone="info">配分 50 / 50</Badge>
          </CardHeader>
          <CardBody>
            <MessageBlock body={message.abVariantB} placeholder="(案 B が設定されていません)" maxLen={1500} />
          </CardBody>
        </Card>
      )}

      <Card className="lg:col-span-2">
        <CardHeader>
          <CardTitle>AI 採用ログ / 編集差分</CardTitle>
          <Badge tone="neutral">
            <Eye className="size-3" aria-hidden />
            Phase2
          </Badge>
        </CardHeader>
        <CardBody>
          <div className="text-[12px] text-ink-500 [color:var(--color-ink-500)] leading-relaxed">
            AI ドラフトの採用率 / 編集差分のヒートマップは Phase2 で実装予定です。
            設計書 §16.4 ナレッジ効果検証に従い、引用率と引用→採用率を計測します。
          </div>
        </CardBody>
      </Card>
    </div>
  );
}

function MessageBlock({
  body,
  placeholder,
  maxLen,
}: {
  body?: string;
  placeholder: string;
  maxLen: number;
}) {
  const text = body?.trim() ?? "";
  return (
    <>
      {text ? (
        <pre className="font-sans text-[13px] text-ink-800 [color:var(--color-ink-800)] whitespace-pre-wrap break-words leading-relaxed">
          {text}
        </pre>
      ) : (
        <div className="text-[12px] text-ink-400 [color:var(--color-ink-400)] italic">{placeholder}</div>
      )}
      <div className="mt-3 text-[10px] tabular font-mono text-ink-400 [color:var(--color-ink-400)]">
        {text.length} / {maxLen} 文字
      </div>
    </>
  );
}
