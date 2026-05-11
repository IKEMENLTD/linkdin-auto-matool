import Link from "next/link";
import {
  Bell,
  ShieldAlert,
  AlertTriangle,
  Info,
  CheckCircle2,
  MessageSquare,
  Hourglass,
  Activity,
} from "lucide-react";
import { Header } from "@/components/app/header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { fmtRelative } from "@/lib/formatters";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";
export const metadata = { title: "通知" };

type Level = "critical" | "warning" | "action" | "info";

type Notification = {
  id: string;
  level: Level;
  title: string;
  description: string;
  href: string;
  occurredAt: string;
  read: boolean;
};

const LEVEL_META: Record<Level, { ja: string; tone: "danger" | "warning" | "info" | "neutral"; icon: typeof ShieldAlert }> = {
  critical: { ja: "Critical", tone: "danger", icon: ShieldAlert },
  warning: { ja: "Warning", tone: "warning", icon: AlertTriangle },
  action: { ja: "Action", tone: "info", icon: MessageSquare },
  info: { ja: "Info", tone: "neutral", icon: Info },
};

const TABS: { key: "all" | Level; label: string }[] = [
  { key: "all", label: "すべて" },
  { key: "critical", label: "Critical" },
  { key: "warning", label: "Warning" },
  { key: "action", label: "Action" },
  { key: "info", label: "Info" },
];

const ALLOWED = new Set<string>(["all", "critical", "warning", "action", "info"]);

export default async function NotificationsPage({
  searchParams,
}: {
  searchParams: Promise<{ level?: string }>;
}) {
  const sp = await searchParams;
  const filter = (ALLOWED.has(sp.level ?? "") ? (sp.level as "all" | Level) : "all");

  const notifications = mockNotifications();
  const filtered =
    filter === "all" ? notifications : notifications.filter((n) => n.level === filter);
  const counts = {
    critical: notifications.filter((n) => n.level === "critical").length,
    warning: notifications.filter((n) => n.level === "warning").length,
    action: notifications.filter((n) => n.level === "action").length,
    info: notifications.filter((n) => n.level === "info").length,
  };
  const unreadCount = notifications.filter((n) => !n.read).length;

  return (
    <>
      <Header
        title="通知"
        subtitle={`${notifications.length} 件 · 未読 ${unreadCount}`}
      />

      <div className="px-4 sm:px-6 lg:px-10 py-6 lg:py-8 space-y-5 max-w-[1280px]">
        <div role="status" className="flex items-center gap-2 text-[12px] text-ink-500 [color:var(--color-ink-500)]">
          <Badge tone="info">DEMO</Badge>
          通知の永続化と SSE による即時反映は Phase2 で実装します (設計書 §11)。
        </div>

        <div className="flex items-end justify-between gap-3 flex-wrap">
          <div>
            <h2 className="font-display text-[26px] lg:text-[32px] font-bold tracking-tight text-ink-900 [color:var(--color-ink-900)]">
              通知センター
            </h2>
            <p className="text-[12px] text-ink-500 [color:var(--color-ink-500)] mt-1 inline-flex items-center gap-2">
              <Bell className="size-3.5 text-[var(--color-brand-600)]" aria-hidden />
              Critical は誰も OFF にできません (設計書 §11.1.1)
            </p>
          </div>
          <Button variant="secondary" disabled title="Phase2 で実装予定">
            すべて既読 (Phase2)
          </Button>
        </div>

        <div role="group" aria-label="通知フィルタ" className="flex items-center gap-1 overflow-x-auto">
          {TABS.map((t) => {
            const active = filter === t.key;
            const count =
              t.key === "all"
                ? notifications.length
                : counts[t.key as Level] ?? 0;
            return (
              <Link
                key={t.key}
                aria-pressed={active}
                href={t.key === "all" ? "/notifications" : `/notifications?level=${t.key}`}
                className={cn(
                  "inline-flex items-center gap-2 px-3.5 py-2 text-[13px] font-medium rounded-full transition shrink-0",
                  active
                    ? "bg-[linear-gradient(180deg,rgba(186,230,253,0.55),rgba(240,249,255,0.7))] border border-[var(--color-brand-200)] text-[var(--color-brand-800)]"
                    : "text-ink-500 [color:var(--color-ink-500)] hover:text-ink-900 hover:bg-[var(--color-brand-50)]/40 border border-transparent"
                )}
              >
                {t.label}
                {count > 0 && (
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
            <li className="px-5 py-10 text-center text-[13px] text-ink-500 [color:var(--color-ink-500)]">
              該当する通知はありません
            </li>
          ) : (
            filtered.map((n) => {
              const meta = LEVEL_META[n.level];
              const Icon = meta.icon;
              return (
                <li key={n.id}>
                  <Link
                    href={n.href}
                    className={cn(
                      "flex items-start gap-3 px-4 py-3 hover:bg-[var(--color-brand-50)]/60 transition",
                      n.level === "critical" && "bg-[var(--color-danger-50)]/30"
                    )}
                  >
                    <span
                      className={cn(
                        "size-8 rounded-lg border grid place-content-center shrink-0",
                        meta.tone === "danger" &&
                          "border-[#FECACA] bg-[var(--color-danger-50)] text-[var(--color-danger-700)]",
                        meta.tone === "warning" &&
                          "border-[#FDE68A] bg-[var(--color-warning-50)] text-[var(--color-warning-700)]",
                        meta.tone === "info" &&
                          "border-[var(--color-brand-200)] bg-[var(--color-brand-50)] text-[var(--color-brand-700)]",
                        meta.tone === "neutral" &&
                          "border-[var(--color-ink-200)] bg-white text-ink-500"
                      )}
                    >
                      <Icon className="size-4" aria-hidden />
                    </span>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <Badge tone={meta.tone}>{meta.ja}</Badge>
                        <span className="font-medium text-[13.5px] text-ink-900 [color:var(--color-ink-900)] truncate">
                          {n.title}
                        </span>
                        {!n.read && (
                          <span className="size-1.5 rounded-full bg-[var(--color-brand-500)]" aria-label="未読" />
                        )}
                      </div>
                      <div className="text-[12px] text-ink-500 [color:var(--color-ink-500)] mt-0.5 truncate">
                        {n.description}
                      </div>
                      <div className="text-[10px] tabular font-mono text-ink-400 [color:var(--color-ink-400)] mt-1">
                        {fmtRelative(n.occurredAt)}
                      </div>
                    </div>
                  </Link>
                </li>
              );
            })
          )}
        </ul>
      </div>
    </>
  );
}

function mockNotifications(): Notification[] {
  const now = Date.now();
  return [
    {
      id: "n1",
      level: "critical",
      title: "鈴木 大輔さんのアカウントが安全モードに切替えられました",
      description: "失敗連続 5 回を検知。手動でログイン → CAPTCHA 解除を推奨",
      href: "/connections/linkedin",
      occurredAt: new Date(now - 6 * 3600_000).toISOString(),
      read: false,
    },
    {
      id: "n2",
      level: "warning",
      title: "佐藤 美咲さんのウォームアップが Day 7 で停滞しています",
      description: "失敗率の閾値を下回るまで段階アップは保留されます",
      href: "/connections/linkedin",
      occurredAt: new Date(now - 12 * 3600_000).toISOString(),
      read: false,
    },
    {
      id: "n3",
      level: "action",
      title: "山田 太郎さんから返信が届きました",
      description: "「価格と他社比較について、もう少し詳しくお伺いできますでしょうか。」",
      href: "/inbox/l1",
      occurredAt: new Date(now - 3 * 3600_000).toISOString(),
      read: false,
    },
    {
      id: "n4",
      level: "action",
      title: "森田 翼さんとの商談がカレンダー登録されました",
      description: "来週火曜 15:00 · CRM に Deal を作成しました",
      href: "/inbox/l8",
      occurredAt: new Date(now - 22 * 3600_000).toISOString(),
      read: true,
    },
    {
      id: "n5",
      level: "info",
      title: "今月の使用状況サマリ",
      description: "リード処理 821/1500 · AI 生成 4,210/5,000 (本日時点)",
      href: "/settings/plan",
      occurredAt: new Date(now - 36 * 3600_000).toISOString(),
      read: true,
    },
    {
      id: "n6",
      level: "action",
      title: "ジョブが 3 件失敗しました",
      description: "Unipile API レスポンスが 5xx · 自動リトライ中",
      href: "/jobs?status=failed",
      occurredAt: new Date(now - 8 * 3600_000).toISOString(),
      read: false,
    },
  ];
}
