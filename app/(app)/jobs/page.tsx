import Link from "next/link";
import {
  Activity,
  RotateCcw,
  Trash2,
  ChevronRight,
  CheckCircle2,
  Loader2,
  AlertCircle,
  PauseCircle,
  Inbox,
  Lock,
} from "lucide-react";
import { Header } from "@/components/app/header";
import { Badge } from "@/components/ui/badge";
import { fmtRelative } from "@/lib/formatters";
import { getSession, hasAtLeastRole } from "@/lib/auth";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";
export const metadata = { title: "ジョブ / 失敗 / DLQ" };

type JobStatus = "running" | "completed" | "failed" | "dlq";

type Job = {
  id: string;
  kind: string;
  payload: string;
  status: JobStatus;
  attempts: number;
  nextRetryAt: string | null;
  errorMessage: string | null;
  correlationId: string;
  createdAt: string;
};

const STATUS_META: Record<
  JobStatus,
  { ja: string; tone: "brand" | "success" | "warning" | "danger"; icon: typeof Activity }
> = {
  running: { ja: "実行中", tone: "brand", icon: Loader2 },
  completed: { ja: "完了", tone: "success", icon: CheckCircle2 },
  failed: { ja: "失敗", tone: "warning", icon: AlertCircle },
  dlq: { ja: "DLQ", tone: "danger", icon: PauseCircle },
};

const TABS: { key: "all" | JobStatus; label: string }[] = [
  { key: "all", label: "すべて" },
  { key: "running", label: "実行中" },
  { key: "failed", label: "失敗" },
  { key: "dlq", label: "DLQ" },
  { key: "completed", label: "完了" },
];

const ALLOWED = new Set(["all", "running", "failed", "dlq", "completed"]);

export default async function JobsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const sp = await searchParams;
  const filter = (ALLOWED.has(sp.status ?? "") ? (sp.status as "all" | JobStatus) : "all");

  const session = await getSession();
  if (session && !hasAtLeastRole(session.role, "operator")) {
    return (
      <>
        <Header title="ジョブ / 失敗 / DLQ" subtitle="権限が不足しています" />
        <div className="px-6 lg:px-10 py-8">
          <div role="alert" className="flex items-start gap-2.5 text-[13px] rounded-2xl border border-[#FECACA] bg-[var(--color-danger-50)] text-[var(--color-danger-700)] px-4 py-3">
            <Lock className="size-4 mt-0.5 shrink-0" aria-hidden />
            ジョブ / 失敗 / DLQ の閲覧は Operator 以上の権限が必要です。
          </div>
        </div>
      </>
    );
  }

  const jobs = mockJobs();
  const filtered = filter === "all" ? jobs : jobs.filter((j) => j.status === filter);

  const stats = {
    running: jobs.filter((j) => j.status === "running").length,
    failed: jobs.filter((j) => j.status === "failed").length,
    dlq: jobs.filter((j) => j.status === "dlq").length,
    completed: jobs.filter((j) => j.status === "completed").length,
    failureRate1h: 1.2,
  };

  return (
    <>
      <Header
        title="ジョブ / 失敗 / DLQ"
        subtitle={`実行中 ${stats.running} · 失敗 ${stats.failed} · DLQ ${stats.dlq}`}
      />

      <div className="px-4 sm:px-6 lg:px-10 py-6 lg:py-8 space-y-5 max-w-[1280px]">
        <div role="status" className="flex items-center gap-2 text-[12px] text-ink-500 [color:var(--color-ink-500)]">
          <Badge tone="info">DEMO</Badge>
          BullMQ + Redis 配線は Phase2 で実装します。
        </div>

        <div>
          <h2 className="font-display text-[26px] lg:text-[32px] font-bold tracking-tight text-ink-900 [color:var(--color-ink-900)]">
            ジョブキュー
          </h2>
          <p className="text-[12px] text-ink-500 [color:var(--color-ink-500)] mt-1 inline-flex items-center gap-2">
            <Activity className="size-3.5 text-[var(--color-brand-600)]" aria-hidden />
            直近 1h 失敗率: <span className="tabular font-mono">{stats.failureRate1h}%</span> · バックログ: 0 件
          </p>
        </div>

        <div role="group" aria-label="ジョブステータスフィルタ" className="flex items-center gap-1 overflow-x-auto">
          {TABS.map((t) => {
            const active = filter === t.key;
            const count =
              t.key === "all"
                ? jobs.length
                : stats[t.key as keyof typeof stats] as number;
            return (
              <Link
                key={t.key}
                href={t.key === "all" ? "/jobs" : `/jobs?status=${t.key}`}
                aria-pressed={active}
                className={cn(
                  "inline-flex items-center gap-2 px-3.5 py-2 text-[13px] font-medium rounded-full transition shrink-0",
                  active
                    ? "bg-[linear-gradient(180deg,rgba(186,230,253,0.55),rgba(240,249,255,0.7))] border border-[var(--color-brand-200)] text-[var(--color-brand-800)]"
                    : "text-ink-500 [color:var(--color-ink-500)] hover:text-ink-900 hover:bg-[var(--color-brand-50)]/40 border border-transparent"
                )}
              >
                {t.label}
                {typeof count === "number" && count > 0 && (
                  <span
                    className={cn(
                      "tabular font-mono text-[10px] font-bold rounded-full px-1.5 py-0.5",
                      active
                        ? "bg-[var(--color-brand-500)] text-white"
                        : "bg-[var(--color-ink-100)] text-ink-600 [color:var(--color-ink-600)]"
                    )}
                  >
                    {count}
                  </span>
                )}
              </Link>
            );
          })}
        </div>

        <ul className="card-solid divide-y divide-[var(--color-ink-100)]">
          {filtered.length === 0 ? (
            <li className="px-5 py-10 text-center text-[13px] text-ink-500 [color:var(--color-ink-500)] inline-flex items-center justify-center gap-2 w-full">
              <Inbox className="size-4" aria-hidden />
              該当するジョブはありません
            </li>
          ) : (
            filtered.map((j) => {
              const meta = STATUS_META[j.status];
              const Icon = meta.icon;
              return (
                <li key={j.id} className="px-4 py-3 grid grid-cols-1 md:grid-cols-[1.6fr_120px_80px_140px_120px] gap-3 items-center">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <Badge tone={meta.tone}>
                        <Icon
                          className={cn(
                            "size-3",
                            j.status === "running" && "animate-spin"
                          )}
                          aria-hidden
                        />
                        {meta.ja}
                      </Badge>
                      <span className="font-medium text-[13px] text-ink-900 [color:var(--color-ink-900)] truncate">
                        {j.kind}
                      </span>
                    </div>
                    <div className="text-[11px] text-ink-500 [color:var(--color-ink-500)] font-mono tabular truncate mt-0.5">
                      {j.payload}
                    </div>
                    {j.errorMessage && (
                      <div className="mt-1 text-[11px] text-[var(--color-danger-700)] truncate">
                        ⚠ {j.errorMessage}
                      </div>
                    )}
                  </div>
                  <div className="hidden md:block text-[11px] text-ink-500 [color:var(--color-ink-500)] font-mono tabular truncate">
                    corr: {j.correlationId.slice(0, 8)}
                  </div>
                  <div className="hidden md:block text-right text-[12px] tabular font-mono text-ink-700 [color:var(--color-ink-700)]">
                    {j.attempts} 回
                  </div>
                  <div className="hidden md:block text-[11px] text-ink-500 [color:var(--color-ink-500)] tabular font-mono">
                    {j.nextRetryAt ? `再試行 ${fmtRelative(j.nextRetryAt)}` : fmtRelative(j.createdAt)}
                  </div>
                  <div className="flex items-center justify-end gap-1">
                    {j.status === "failed" || j.status === "dlq" ? (
                      <>
                        <button
                          type="button"
                          disabled
                          aria-label="再試行"
                          title="Phase2 で実装予定"
                          className="size-8 grid place-content-center rounded-full border border-[var(--color-ink-200)] text-ink-500 hover:bg-[var(--color-brand-50)] hover:text-[var(--color-brand-700)] transition"
                        >
                          <RotateCcw className="size-3.5" aria-hidden />
                        </button>
                        <button
                          type="button"
                          disabled
                          aria-label="DLQ へ送る / 廃棄"
                          title="Phase2 で実装予定"
                          className="size-8 grid place-content-center rounded-full border border-[#FECACA] text-[var(--color-danger-700)] hover:bg-[var(--color-danger-50)] transition"
                        >
                          <Trash2 className="size-3.5" aria-hidden />
                        </button>
                      </>
                    ) : (
                      <ChevronRight className="size-4 text-ink-300 [color:var(--color-ink-300)]" aria-hidden />
                    )}
                  </div>
                </li>
              );
            })
          )}
        </ul>
      </div>
    </>
  );
}

function mockJobs(): Job[] {
  const now = Date.now();
  return [
    job("j1", "send_message", "lead=l1, account=hayashi", "running", 1, null, null, 0.1),
    job("j2", "enrich_profile", "lead=l4", "running", 1, null, null, 0.05),
    job("j3", "send_connection_request", "lead=l11", "failed", 2, new Date(now + 10 * 60_000).toISOString(), "Unipile 503 Service Unavailable", 1),
    job("j4", "send_message", "lead=l12", "dlq", 5, null, "Recipient is no longer a 1st connection", 90),
    job("j5", "qualify_lead", "lead=l9", "completed", 1, null, null, 4),
    job("j6", "scrape_search_result", "campaign=c1, query=#3", "completed", 1, null, null, 6),
    job("j7", "send_message", "lead=l8", "completed", 1, null, null, 1),
  ];
}

function job(
  id: string,
  kind: string,
  payload: string,
  status: JobStatus,
  attempts: number,
  nextRetryAt: string | null,
  errorMessage: string | null,
  hoursAgo: number
): Job {
  return {
    id,
    kind,
    payload,
    status,
    attempts,
    nextRetryAt,
    errorMessage,
    correlationId: `${id}-corr-${"0".repeat(28)}`.slice(0, 36),
    createdAt: new Date(Date.now() - hoursAgo * 3600_000).toISOString(),
  };
}
