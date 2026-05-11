import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Pencil, Info } from "lucide-react";
import type { CampaignDetail } from "@/server/queries/campaign-detail";
import { OBJECTIVE_META, type Objective } from "@/lib/wizard-schema";

type Delivery = {
  accountIds?: string[];
  dailyLimit?: number;
  effectiveDailyLimit?: number;
  startTime?: string;
  endTime?: string;
  weekdaysOnly?: boolean;
  reviewMode?: "review_required" | "semi_auto";
};

export function TabSettings({ detail }: { detail: CampaignDetail }) {
  const objective = detail.productDocs?.objective as Objective | undefined;
  const delivery = (detail.productDocs?.delivery ?? {}) as Delivery;
  const dailyLimit = delivery.effectiveDailyLimit ?? delivery.dailyLimit ?? null;

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-[var(--color-brand-200)] bg-[var(--color-brand-50)]/40 px-4 py-3 text-[12px] text-ink-700 [color:var(--color-ink-700)] flex items-start gap-2">
        <Info className="size-4 mt-0.5 shrink-0 text-[var(--color-brand-600)]" aria-hidden />
        <div className="leading-relaxed">
          実行中のキャンペーンの設定編集は Phase2 で対応予定です。設定変更後は「実行中の設定との差分」が表示され、Manager 以上の再承認が必要になります (設計書 §5.6.1)。
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>キャンペーン基本</CardTitle>
          <button
            type="button"
            disabled
            aria-disabled
            title="編集機能は Phase2 で実装予定です"
            className="inline-flex items-center gap-1 text-[12px] text-ink-300 [color:var(--color-ink-300)] cursor-not-allowed"
          >
            <Pencil className="size-3.5" aria-hidden />
            編集 (Phase2)
          </button>
        </CardHeader>
        <CardBody className="space-y-3 text-[13px]">
          <Row label="目的">
            {objective ? OBJECTIVE_META[objective].ja : <Muted>未設定</Muted>}
          </Row>
          <Row label="ICP">
            <span className="whitespace-pre-wrap">{detail.icpDescription || <Muted>未設定</Muted>}</span>
          </Row>
          <Row label="HITL モード">
            <Badge tone="brand">
              {detail.hitlState === "FULL_AUTO"
                ? "自動送信"
                : detail.hitlState === "SEMI_AUTO"
                ? "セミ自動"
                : "レビュー必須"}
            </Badge>
          </Row>
          <Row label="開始日">
            {detail.startsAt ? (
              <span className="tabular font-mono">
                {new Intl.DateTimeFormat("ja-JP", {
                  timeZone: "Asia/Tokyo",
                  year: "numeric",
                  month: "long",
                  day: "numeric",
                }).format(new Date(detail.startsAt))}
              </span>
            ) : (
              <Muted>未設定</Muted>
            )}
          </Row>
          <Row label="作成日">
            <span className="tabular font-mono text-ink-500 [color:var(--color-ink-500)]">
              {new Intl.DateTimeFormat("ja-JP", {
                timeZone: "Asia/Tokyo",
                year: "numeric",
                month: "long",
                day: "numeric",
              }).format(new Date(detail.createdAt))}
            </span>
          </Row>
        </CardBody>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>配信設定</CardTitle>
        </CardHeader>
        <CardBody className="space-y-3 text-[13px]">
          <Row label="担当アカウント数">
            <span className="tabular font-mono">{delivery.accountIds?.length ?? 0}</span>
          </Row>
          <Row label="日次上限 (申請)">
            <span className="tabular font-mono">{delivery.dailyLimit ?? "—"} 件/日</span>
          </Row>
          <Row label="日次上限 (実効)" hint="ウォームアップ段階で押し戻された後の値">
            <span className="tabular font-mono text-[var(--color-brand-700)] font-semibold">
              {dailyLimit ?? "—"} 件/日
            </span>
          </Row>
          <Row label="送信時間帯">
            <span className="tabular font-mono">
              {delivery.startTime ?? "—"} 〜 {delivery.endTime ?? "—"}
            </span>
          </Row>
          <Row label="平日のみ送信">
            <Badge tone={delivery.weekdaysOnly ? "success" : "neutral"}>
              {delivery.weekdaysOnly ? "ON" : "OFF"}
            </Badge>
          </Row>
          <Row label="レビューモード">
            <Badge tone="brand">
              {delivery.reviewMode === "semi_auto" ? "セミ自動" : "レビュー必須"}
            </Badge>
          </Row>
        </CardBody>
      </Card>
    </div>
  );
}

function Row({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="grid grid-cols-[160px_1fr] gap-3 items-start">
      <div className="text-[11px] font-medium tracking-[0.12em] uppercase text-ink-400 [color:var(--color-ink-400)] mt-0.5">
        {label}
        {hint && (
          <div className="font-normal normal-case text-[10px] tracking-normal text-ink-400 [color:var(--color-ink-400)] mt-0.5">
            {hint}
          </div>
        )}
      </div>
      <div className="text-ink-900 [color:var(--color-ink-900)]">{children}</div>
    </div>
  );
}

function Muted({ children }: { children: React.ReactNode }) {
  return <span className="text-ink-400 [color:var(--color-ink-400)]">{children}</span>;
}
