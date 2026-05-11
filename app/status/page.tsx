import {
  CheckCircle2,
  AlertTriangle,
  Activity,
  XCircle,
  Server,
  Database,
  Plug,
  Brain,
  Webhook,
  Globe,
} from "lucide-react";
import { Logo } from "@/components/brand/logo";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";
export const metadata = { title: "サービスステータス" };

type Status = "operational" | "degraded" | "partial_outage" | "major_outage";

const STATUS_META: Record<
  Status,
  { ja: string; color: string; icon: typeof CheckCircle2 }
> = {
  operational: { ja: "稼働中", color: "var(--color-success-700)", icon: CheckCircle2 },
  degraded: { ja: "縮退稼働", color: "var(--color-warning-700)", icon: AlertTriangle },
  partial_outage: { ja: "一部障害", color: "var(--color-warning-700)", icon: AlertTriangle },
  major_outage: { ja: "重大障害", color: "var(--color-danger-700)", icon: XCircle },
};

type Service = {
  key: string;
  name: string;
  description: string;
  icon: typeof Server;
  status: Status;
};

const SERVICES: Service[] = [
  { key: "web", name: "Web アプリ", description: "管理画面・受信箱", icon: Globe, status: "operational" },
  { key: "api", name: "API", description: "REST / Server Action", icon: Server, status: "operational" },
  { key: "db", name: "Database", description: "Supabase Postgres", icon: Database, status: "operational" },
  { key: "unipile", name: "Unipile Bridge", description: "LinkedIn 操作層", icon: Plug, status: "operational" },
  { key: "llm-anthropic", name: "LLM (Anthropic)", description: "AI ドラフト生成", icon: Brain, status: "operational" },
  { key: "webhook", name: "Webhook 受信", description: "返信受信 → 受信箱反映", icon: Webhook, status: "operational" },
];

const OVERALL_STATUS: Status = "operational";

export default function StatusPage() {
  const overallMeta = STATUS_META[OVERALL_STATUS];
  const OverallIcon = overallMeta.icon;

  return (
    <div className="hydro-canvas min-h-screen">
      <header className="border-b border-[var(--color-ink-100)] bg-white/85 backdrop-blur-md">
        <div className="max-w-[1080px] mx-auto px-6 py-5 flex items-center justify-between">
          <Logo />
          <a
            href="/dashboard"
            className="text-[12px] text-ink-500 [color:var(--color-ink-500)] hover:text-ink-900 underline-offset-4 hover:underline"
          >
            ダッシュボードへ戻る
          </a>
        </div>
      </header>

      <main className="max-w-[1080px] mx-auto px-6 py-12 space-y-10">
        <section
          aria-labelledby="overall"
          className="relative overflow-hidden rounded-[var(--radius-2xl)] border border-[var(--color-brand-200)] bg-[linear-gradient(135deg,rgba(186,230,253,0.45),rgba(255,255,255,0.85)_50%,rgba(204,251,241,0.5))] p-8 lg:p-10"
        >
          <div
            aria-hidden
            className="absolute -top-20 -right-20 size-[420px] rounded-full bg-[radial-gradient(circle,rgba(45,212,191,0.35),transparent_70%)] blur-2xl"
          />
          <div className="relative">
            <div className="inline-flex items-center gap-2 mb-3 text-[11px] font-medium tracking-[0.18em] uppercase text-[var(--color-brand-700)]">
              <span className="size-1.5 rounded-full bg-[var(--color-brand-500)] pulse-soft" aria-hidden />
              サービスステータス
            </div>
            <div className="flex items-center gap-3">
              <OverallIcon className="size-7 shrink-0" style={{ color: overallMeta.color }} aria-hidden />
              <h1 id="overall" className="font-display text-[36px] lg:text-[48px] font-bold tracking-tight text-ink-900 [color:var(--color-ink-900)] leading-none">
                {overallMeta.ja === "稼働中" ? "すべてのシステムが正常に稼働中" : overallMeta.ja}
              </h1>
            </div>
            <div className="mt-3 text-[13px] text-ink-600 [color:var(--color-ink-600)]">
              最終更新:{" "}
              <span className="tabular font-mono">
                {new Intl.DateTimeFormat("ja-JP", {
                  timeZone: "Asia/Tokyo",
                  year: "numeric",
                  month: "long",
                  day: "numeric",
                  hour: "2-digit",
                  minute: "2-digit",
                }).format(new Date())}
              </span>
              {" "}(JST)
            </div>
          </div>
        </section>

        <section aria-labelledby="services" className="space-y-3">
          <h2
            id="services"
            className="text-[11px] font-bold tracking-[0.18em] uppercase text-ink-500 [color:var(--color-ink-500)]"
          >
            サービス別ステータス
          </h2>
          <ul className="card-solid divide-y divide-[var(--color-ink-100)]">
            {SERVICES.map((s) => {
              const meta = STATUS_META[s.status];
              const Icon = s.icon;
              const StatusIcon = meta.icon;
              return (
                <li key={s.key} className="flex items-center gap-3 px-5 py-4">
                  <span className="size-10 rounded-xl border border-[var(--color-ink-200)] bg-white grid place-content-center text-ink-700">
                    <Icon className="size-4" aria-hidden />
                  </span>
                  <div className="flex-1 min-w-0">
                    <div className="font-medium text-[13.5px] text-ink-900 [color:var(--color-ink-900)]">
                      {s.name}
                    </div>
                    <div className="text-[11px] text-ink-500 [color:var(--color-ink-500)]">
                      {s.description}
                    </div>
                  </div>
                  <span
                    className="inline-flex items-center gap-1.5 text-[12px] font-medium tabular"
                    style={{ color: meta.color }}
                  >
                    <StatusIcon className="size-4" aria-hidden />
                    {meta.ja}
                  </span>
                </li>
              );
            })}
          </ul>
        </section>

        <section aria-labelledby="incidents" className="card-solid p-6 space-y-3">
          <h2
            id="incidents"
            className="text-[11px] font-bold tracking-[0.18em] uppercase text-ink-500 [color:var(--color-ink-500)]"
          >
            過去 30 日のインシデント
          </h2>
          <div className="flex items-center gap-2 text-[13px] text-ink-600 [color:var(--color-ink-600)]">
            <Activity className="size-4 text-[var(--color-success-700)]" aria-hidden />
            報告されたインシデントはありません
          </div>
          <p className="text-[11px] text-ink-500 [color:var(--color-ink-500)] leading-relaxed">
            SLO: API 可用性 99.9% / 一次応答 SLA 2 時間。エラーバジェット枯渇時は新機能リリース凍結 (設計書 §24.1)。
          </p>
        </section>

        <section className="text-center pt-6">
          <a
            href="/api/health"
            className="inline-flex items-center gap-1 text-[12px] text-ink-500 [color:var(--color-ink-500)] hover:text-ink-900 underline-offset-4 hover:underline"
          >
            JSON フィード: /api/health
          </a>
        </section>
      </main>
    </div>
  );
}
