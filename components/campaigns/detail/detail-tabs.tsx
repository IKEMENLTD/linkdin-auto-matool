import Link from "next/link";
import { cn } from "@/lib/utils";

export type DetailTab = "overview" | "leads" | "messages" | "settings";

const TABS: { key: DetailTab; label: string }[] = [
  { key: "overview", label: "概要" },
  { key: "leads", label: "リード" },
  { key: "messages", label: "メッセージ" },
  { key: "settings", label: "設定" },
];

interface Props {
  current: DetailTab;
  campaignId: string;
}

export function DetailTabs({ current, campaignId }: Props) {
  return (
    <nav
      role="tablist"
      aria-label="キャンペーン詳細タブ"
      className="flex items-center gap-1 border-b border-[var(--color-ink-100)] overflow-x-auto"
    >
      {TABS.map((t) => {
        const active = t.key === current;
        return (
          <Link
            key={t.key}
            id={`tablabel-${t.key}`}
            role="tab"
            aria-selected={active}
            aria-controls={`tab-${t.key}`}
            tabIndex={active ? 0 : -1}
            href={`/campaigns/${campaignId}${t.key === "overview" ? "" : `?tab=${t.key}`}`}
            className={cn(
              "relative inline-flex items-center gap-2 px-4 py-2.5 text-[13px] font-medium transition shrink-0",
              active
                ? "text-[var(--color-brand-700)]"
                : "text-ink-500 [color:var(--color-ink-500)] hover:text-ink-900"
            )}
          >
            {t.label}
            {active && (
              <span
                aria-hidden
                className="absolute -bottom-px left-2 right-2 h-[2px] rounded-full bg-[linear-gradient(90deg,#38BDF8,#0EA5E9,#14B8A6)]"
              />
            )}
          </Link>
        );
      })}
    </nav>
  );
}
