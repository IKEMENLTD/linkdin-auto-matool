"use client";

import * as React from "react";
import { Bell, Search, Sparkles, Menu } from "lucide-react";
import { Button } from "@/components/ui/button";
import { MobileSidebar } from "@/components/app/sidebar";

export function Header({
  title,
  subtitle,
  as = "h1",
}: {
  title: string;
  subtitle?: string;
  /** ページ内に別の <h1> がある場合 (キャンペーン詳細など) は "p" に格下げ */
  as?: "h1" | "p";
}) {
  const [navOpen, setNavOpen] = React.useState(false);
  const TitleTag = as;

  return (
    <>
      <header className="sticky top-0 z-30 flex items-center gap-3 px-4 lg:px-10 h-16 border-b border-[var(--color-ink-100)] bg-white/85 backdrop-blur-md">
        <button
          type="button"
          onClick={() => setNavOpen(true)}
          aria-label="メニューを開く"
          className="lg:hidden size-9 grid place-content-center rounded-full border border-[var(--color-ink-200)] bg-white hover:border-[var(--color-brand-300)]"
        >
          <Menu className="size-4" aria-hidden />
        </button>

        <div className="min-w-0">
          <TitleTag className="text-[15px] font-semibold tracking-tight text-ink-900 [color:var(--color-ink-900)]">
            {title}
          </TitleTag>
          {subtitle && (
            <div className="text-[12px] text-ink-500 [color:var(--color-ink-500)] truncate">
              {subtitle}
            </div>
          )}
        </div>

        <div className="ml-auto flex items-center gap-2">
          <button
            type="button"
            aria-label="検索 (Cmd+K)"
            className="hidden md:flex items-center gap-2 h-9 w-[260px] px-3 rounded-full border border-[var(--color-ink-200)] bg-white text-[12px] text-ink-500 [color:var(--color-ink-500)] hover:border-[var(--color-brand-300)] transition"
          >
            <Search
              className="size-4 text-ink-400 [color:var(--color-ink-400)]"
              aria-hidden
            />
            <span className="flex-1 text-left">リード・キャンペーンを検索…</span>
            <kbd className="font-mono text-[10px] tabular bg-[var(--color-ink-100)] rounded px-1.5 py-0.5">
              ⌘K
            </kbd>
          </button>

          <Button size="sm" variant="secondary" className="hidden sm:inline-flex rounded-full gap-1.5">
            <Sparkles className="size-3.5 text-[var(--color-brand-600)]" aria-hidden />
            AI アシスタント
          </Button>

          <button
            type="button"
            aria-label="通知 (3 件)"
            className="relative h-9 w-9 grid place-content-center rounded-full border border-[var(--color-ink-200)] bg-white hover:border-[var(--color-brand-300)] hover:bg-[var(--color-brand-50)] transition"
          >
            <Bell
              className="size-4 text-ink-700 [color:var(--color-ink-700)]"
              strokeWidth={1.85}
              aria-hidden
            />
            <span
              aria-hidden
              className="absolute top-1.5 right-1.5 size-2 rounded-full bg-[var(--color-brand-500)] pulse-soft"
            />
          </button>

          <button
            type="button"
            aria-label="ユーザーメニュー"
            className="flex items-center gap-2 h-9 pl-1 pr-3 rounded-full border border-[var(--color-ink-200)] bg-white hover:border-[var(--color-brand-300)] transition"
          >
            <span className="size-7 rounded-full bg-[linear-gradient(135deg,#BAE6FD,#0EA5E9)] text-white grid place-content-center text-[11px] font-bold">
              T
            </span>
            <span className="hidden sm:inline text-[12px] font-medium text-ink-700 [color:var(--color-ink-700)]">
              田中
            </span>
          </button>
        </div>
      </header>

      <MobileSidebar open={navOpen} onClose={() => setNavOpen(false)} />
    </>
  );
}
