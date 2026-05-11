import {
  ArrowUpRight,
  CalendarClock,
  CreditCard,
  Receipt,
  Shield,
  Pause,
} from "lucide-react";
import { Header } from "@/components/app/header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/card";
import { getSession } from "@/lib/auth";
import { fmtCurrency, fmtNumber } from "@/lib/formatters";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";
export const metadata = { title: "プラン / 請求" };

type PlanTier = "solo" | "team" | "scale" | "enterprise";

const PLAN_META: Record<
  PlanTier,
  { ja: string; price: number | "custom"; accounts: number | "custom"; leads: number | "custom"; ai: number | "custom" }
> = {
  solo: { ja: "Solo", price: 9800, accounts: 1, leads: 300, ai: 1500 },
  team: { ja: "Team", price: 48000, accounts: 5, leads: 1500, ai: 5000 },
  scale: { ja: "Scale", price: 148000, accounts: 20, leads: 5000, ai: 20000 },
  enterprise: { ja: "Enterprise", price: "custom", accounts: "custom", leads: "custom", ai: "custom" },
};

// 使用量はモック (Phase2 で実集計)
const USAGE = {
  leads: { used: 821, limit: 1500 },
  ai: { used: 4210, limit: 5000 },
  accounts: { used: 3, limit: 5 },
};

export default async function PlanPage() {
  const session = await getSession();
  const currentPlan: PlanTier = "team";
  const nextRenewal = new Date(Date.now() + 30 * 86_400_000);

  const meta = PLAN_META[currentPlan];

  return (
    <>
      <Header title="プラン / 請求" subtitle={`現在: ${meta.ja}`} />

      <div className="px-4 sm:px-6 lg:px-10 py-6 lg:py-8 space-y-6 max-w-[1280px]">
        {!session && (
          <div role="status" className="flex items-center gap-2 text-[12px] text-ink-500 [color:var(--color-ink-500)]">
            <Badge tone="info">DEMO</Badge>
            未ログイン / DB 未接続のためサンプルプランを表示しています。Stripe 連携は Phase2 で実装。
          </div>
        )}

        <div>
          <h2 className="font-display text-[26px] lg:text-[32px] font-bold tracking-tight text-ink-900 [color:var(--color-ink-900)]">
            プランと請求
          </h2>
          <p className="text-[12px] text-ink-500 [color:var(--color-ink-500)] mt-1">
            設計書 §22 に基づく 4 階層プラン · 上限到達は既定で自動停止
          </p>
        </div>

        {/* 現在のプラン */}
        <section
          aria-labelledby="current-plan"
          className="relative overflow-hidden rounded-[var(--radius-2xl)] border border-[var(--color-brand-200)] bg-[linear-gradient(135deg,rgba(186,230,253,0.45),rgba(255,255,255,0.85)_50%,rgba(204,251,241,0.5))] p-7 lg:p-9"
        >
          <div
            aria-hidden
            className="absolute -top-20 -right-20 size-[420px] rounded-full bg-[radial-gradient(circle,rgba(45,212,191,0.35),transparent_70%)] blur-2xl"
          />
          <div className="relative flex flex-wrap items-end justify-between gap-6">
            <div>
              <div className="inline-flex items-center gap-2 mb-3 text-[11px] font-medium tracking-[0.18em] uppercase text-[var(--color-brand-700)]">
                <span className="size-1.5 rounded-full bg-[var(--color-brand-500)] pulse-soft" aria-hidden />
                現在のプラン
              </div>
              <h2 id="current-plan" className="font-display text-[36px] lg:text-[48px] font-bold tracking-tight text-ink-900 [color:var(--color-ink-900)]">
                {meta.ja}
              </h2>
              <div className="mt-2 flex items-baseline gap-2">
                <span className="kpi-numeral text-[36px]">
                  {typeof meta.price === "number" ? fmtCurrency(meta.price) : "個別見積"}
                </span>
                {typeof meta.price === "number" && (
                  <span className="text-[12px] text-ink-500 [color:var(--color-ink-500)]">/ 月 (税抜)</span>
                )}
              </div>
              <div className="mt-2 inline-flex items-center gap-1.5 text-[12px] text-ink-500 [color:var(--color-ink-500)]">
                <CalendarClock className="size-3.5" aria-hidden />
                次回更新:{" "}
                <span className="font-mono tabular">
                  {new Intl.DateTimeFormat("ja-JP", { timeZone: "Asia/Tokyo", year: "numeric", month: "long", day: "numeric" }).format(nextRenewal)}
                </span>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Button variant="secondary" disabled title="Phase2 で実装予定">
                <Receipt className="size-4" aria-hidden />
                請求書 (Phase2)
              </Button>
              <Button variant="secondary" disabled title="Phase2 で実装予定">
                <CreditCard className="size-4" aria-hidden />
                カードを更新 (Phase2)
              </Button>
              <Button disabled title="Phase2 で実装予定">
                プランを変更 (Phase2)
              </Button>
            </div>
          </div>
        </section>

        {/* 使用状況 */}
        <section aria-labelledby="usage" className="space-y-3">
          <h3
            id="usage"
            className="text-[11px] font-bold tracking-[0.18em] uppercase text-ink-500 [color:var(--color-ink-500)]"
          >
            今月の使用状況
          </h3>
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            <UsageCard
              label="リード処理"
              used={USAGE.leads.used}
              limit={USAGE.leads.limit}
              unit="件"
            />
            <UsageCard label="AI メッセージ生成" used={USAGE.ai.used} limit={USAGE.ai.limit} unit="件" />
            <UsageCard
              label="LinkedIn アカウント"
              used={USAGE.accounts.used}
              limit={USAGE.accounts.limit}
              unit="アカウント"
            />
          </div>
          <p className="text-[11px] text-ink-500 [color:var(--color-ink-500)] leading-relaxed">
            上限到達時の挙動は既定で「自動停止」です。従量課金で続行する場合は Owner の 2FA 再認証 + 月次上限金額の指定が必要です (設計書 §5.11)。
          </p>
        </section>

        {/* プラン比較 */}
        <section aria-labelledby="plan-compare">
          <h3
            id="plan-compare"
            className="text-[11px] font-bold tracking-[0.18em] uppercase text-ink-500 [color:var(--color-ink-500)] mb-3"
          >
            プラン比較
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
            {(Object.keys(PLAN_META) as PlanTier[]).map((tier) => {
              const m = PLAN_META[tier];
              const isCurrent = tier === currentPlan;
              return (
                <Card
                  key={tier}
                  className={
                    isCurrent
                      ? "border-[var(--color-brand-500)] shadow-[0_12px_24px_-14px_rgba(14,165,233,0.4)]"
                      : ""
                  }
                >
                  <CardHeader>
                    <CardTitle className="font-display text-[16px] font-bold tracking-tight text-ink-900 [color:var(--color-ink-900)]">
                      {m.ja}
                    </CardTitle>
                    {isCurrent && <Badge tone="brand">現在</Badge>}
                  </CardHeader>
                  <CardBody className="space-y-2 text-[12px]">
                    <div className="font-display text-[22px] font-bold tabular tracking-tight text-ink-900 [color:var(--color-ink-900)]">
                      {typeof m.price === "number" ? fmtCurrency(m.price) : "個別見積"}
                      {typeof m.price === "number" && (
                        <span className="text-[10px] text-ink-500 [color:var(--color-ink-500)] font-sans font-normal ml-1">
                          / 月
                        </span>
                      )}
                    </div>
                    <Spec label="LinkedIn アカウント">{formatLimit(m.accounts)}</Spec>
                    <Spec label="月次リード処理">{formatLimit(m.leads, "件")}</Spec>
                    <Spec label="AI 生成">{formatLimit(m.ai, "件")}</Spec>
                  </CardBody>
                </Card>
              );
            })}
          </div>
        </section>

        {/* チャーン耐性 / 休止プラン */}
        <section
          aria-labelledby="hibernate"
          className="card-solid p-5 flex items-start gap-3"
        >
          <span className="size-9 rounded-xl grid place-content-center bg-[var(--color-brand-50)] text-[var(--color-brand-700)] border border-[var(--color-brand-200)]">
            <Pause className="size-4" aria-hidden />
          </span>
          <div className="flex-1">
            <h3
              id="hibernate"
              className="font-display text-[14px] font-bold tracking-tight text-ink-900 [color:var(--color-ink-900)]"
            >
              休止プラン (Team / Scale)
            </h3>
            <p className="mt-1 text-[12px] text-ink-600 [color:var(--color-ink-600)] leading-relaxed">
              通常プラン額の 50% / 送信機能停止 / 受信のみ継続 / データ 90 日保持。
              チャーン耐性のキー機能として設計書 §22.1 で定義 (Phase2 で UI 実装)。
            </p>
          </div>
          <a
            href="/legal/usage-policy"
            className="inline-flex items-center gap-1 text-[12px] text-[var(--color-brand-700)] hover:underline shrink-0"
          >
            利用上の注意 <ArrowUpRight className="size-3" aria-hidden />
          </a>
        </section>

        {/* SLA */}
        <section className="card-solid p-5">
          <div className="flex items-start gap-3">
            <span className="size-9 rounded-xl grid place-content-center bg-[var(--color-brand-50)] text-[var(--color-brand-700)] border border-[var(--color-brand-200)]">
              <Shield className="size-4" aria-hidden />
            </span>
            <div className="flex-1 text-[12px] text-ink-700 [color:var(--color-ink-700)] leading-relaxed">
              <strong className="font-semibold text-ink-900 [color:var(--color-ink-900)]">SLA / セキュリティ:</strong>{" "}
              API 可用性 99.9% · 一次応答 SLA 2 時間 (営業時間内) · 監査ログ 13 ヶ月保持 (Enterprise) · DPA / リージョン分離 JP/EU (Scale)。詳細は設計書 §24 / §22 を参照。
            </div>
          </div>
        </section>
      </div>
    </>
  );
}

function UsageCard({
  label,
  used,
  limit,
  unit,
}: {
  label: string;
  used: number;
  limit: number;
  unit: string;
}) {
  const pct = limit > 0 ? Math.min(100, (used / limit) * 100) : 0;
  const warning = pct >= 80;
  return (
    <Card>
      <CardBody className="p-5">
        <div className="text-[11px] font-medium tracking-[0.16em] uppercase text-ink-500 [color:var(--color-ink-500)]">
          {label}
        </div>
        <div className="mt-3 flex items-baseline gap-2">
          <span className="kpi-numeral text-[32px]">{fmtNumber(used)}</span>
          <span className="text-[12px] text-ink-500 [color:var(--color-ink-500)] tabular font-mono">
            / {fmtNumber(limit)} {unit}
          </span>
        </div>
        <div
          role="progressbar"
          aria-valuenow={Math.round(pct)}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label={`${label} 使用率 ${Math.round(pct)}%`}
          className="mt-3 h-1.5 rounded-full bg-[var(--color-ink-100)] overflow-hidden"
        >
          <div
            className={
              warning
                ? "h-full bg-[linear-gradient(90deg,#F59E0B,#B45309)]"
                : "h-full bg-[linear-gradient(90deg,#7DD3FC,#0EA5E9,#14B8A6)]"
            }
            style={{ width: `${Math.max(2, pct)}%` }}
          />
        </div>
        <div className="mt-2 text-[10px] tabular font-mono text-ink-400 [color:var(--color-ink-400)]">
          {Math.round(pct)}% 使用 {warning ? "· 上限警告" : ""}
        </div>
      </CardBody>
    </Card>
  );
}

function Spec({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between text-[11px]">
      <span className="text-ink-500 [color:var(--color-ink-500)]">{label}</span>
      <span className="text-ink-900 [color:var(--color-ink-900)] tabular font-mono font-medium">
        {children}
      </span>
    </div>
  );
}

function formatLimit(v: number | "custom", unit?: string): string {
  if (v === "custom") return "カスタム";
  return `${fmtNumber(v)}${unit ?? ""}`;
}
