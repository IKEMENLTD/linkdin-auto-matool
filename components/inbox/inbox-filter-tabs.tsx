"use client";

import * as React from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Search, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import type { ThreadFilter } from "@/server/queries/inbox";
import { cn } from "@/lib/utils";

const TABS: { key: ThreadFilter; label: string; countKey: "all" | "unread" | "review" | "meeting" }[] = [
  { key: "all", label: "すべて", countKey: "all" },
  { key: "unread", label: "未読", countKey: "unread" },
  { key: "review", label: "要レビュー", countKey: "review" },
  { key: "meeting", label: "商談化", countKey: "meeting" },
];

interface Props {
  current: ThreadFilter;
  counts: { all: number; unread: number; review: number; meeting: number };
}

export function InboxFilterTabs({ current, counts }: Props) {
  const router = useRouter();
  const sp = useSearchParams();
  const qFromUrl = sp.get("q") ?? "";
  const [q, setQ] = React.useState(qFromUrl);

  React.useEffect(() => {
    setQ(qFromUrl);
  }, [qFromUrl]);

  const applyFilter = (next: ThreadFilter) => {
    const params = new URLSearchParams(sp.toString());
    if (next === "all") params.delete("filter");
    else params.set("filter", next);
    params.delete("page");
    router.push(params.size ? `/inbox?${params.toString()}` : "/inbox");
  };

  React.useEffect(() => {
    if (q === qFromUrl) return;
    const h = setTimeout(() => {
      const params = new URLSearchParams(sp.toString());
      if (q) params.set("q", q);
      else params.delete("q");
      params.delete("page");
      router.push(params.size ? `/inbox?${params.toString()}` : "/inbox");
    }, 350);
    return () => clearTimeout(h);
  }, [q, qFromUrl, sp, router]);

  return (
    <div className="flex flex-wrap items-center gap-3 justify-between">
      <div
        role="group"
        aria-label="受信箱フィルタ"
        className="flex items-center gap-1 overflow-x-auto"
      >
        {TABS.map((t) => {
          const active = current === t.key;
          const count = counts[t.countKey];
          return (
            <button
              key={t.key}
              type="button"
              aria-pressed={active}
              onClick={() => applyFilter(t.key)}
              className={cn(
                "relative inline-flex items-center gap-2 px-3.5 py-2 text-[13px] font-medium rounded-full transition shrink-0",
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
            </button>
          );
        })}
      </div>

      <div className="relative">
        <Search
          className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-ink-400 [color:var(--color-ink-400)]"
          aria-hidden
        />
        <Input
          type="search"
          placeholder="名前 / 会社で検索…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          aria-label="受信箱を検索"
          className="h-9 pl-9 pr-8 w-[260px] text-[13px] rounded-full"
        />
        {q && (
          <button
            type="button"
            onClick={() => setQ("")}
            aria-label="検索をクリア"
            className="absolute right-2 top-1/2 -translate-y-1/2 size-6 grid place-content-center rounded-full text-ink-400 hover:text-ink-700"
          >
            <X className="size-3.5" aria-hidden />
          </button>
        )}
      </div>
    </div>
  );
}
