"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Home,
  Target,
  Users,
  MessagesSquare,
  BookOpen,
  Plug,
  Settings,
  LifeBuoy,
  ChevronsUpDown,
  Activity,
  X,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Logo } from "@/components/brand/logo";

type NavItem = {
  href: string;
  label: string;
  icon: LucideIcon;
  badge?: string;
};

const PRIMARY: NavItem[] = [
  { href: "/dashboard", label: "ダッシュボード", icon: Home },
  { href: "/campaigns", label: "キャンペーン", icon: Target },
  { href: "/leads", label: "リード", icon: Users },
  { href: "/inbox", label: "受信箱", icon: MessagesSquare, badge: "12" },
  { href: "/knowledge", label: "ナレッジ", icon: BookOpen },
  { href: "/connections/linkedin", label: "接続", icon: Plug },
  { href: "/settings/profile", label: "設定", icon: Settings },
];

const SECONDARY: NavItem[] = [
  { href: "/jobs", label: "ジョブ / 失敗", icon: Activity },
  { href: "/legal/usage-policy", label: "利用上の注意", icon: LifeBuoy },
];

interface NavProps {
  onItemClick?: () => void;
}

function NavLinks({ onItemClick }: NavProps) {
  const path = usePathname();
  return (
    <>
      <button
        type="button"
        aria-label="ワークスペースを切替える"
        className="mx-3 mt-1 flex items-center justify-between gap-3 rounded-xl px-3 py-2.5 border border-[var(--color-ink-200)] bg-white hover:border-[var(--color-brand-300)] hover:bg-[var(--color-brand-50)] transition"
      >
        <div className="flex items-center gap-2 min-w-0">
          <div
            aria-hidden
            className="size-7 rounded-lg bg-[linear-gradient(135deg,#BAE6FD,#0EA5E9)] text-white grid place-content-center text-xs font-bold"
          >
            IK
          </div>
          <div className="min-w-0 text-left">
            <div className="text-[13px] font-medium text-ink-900 [color:var(--color-ink-900)] truncate">
              IKEMENLTD
            </div>
            <div className="text-[11px] text-ink-500 [color:var(--color-ink-500)] truncate">
              Team プラン
            </div>
          </div>
        </div>
        <ChevronsUpDown
          className="size-4 text-ink-400 [color:var(--color-ink-400)]"
          aria-hidden
        />
      </button>

      <nav aria-label="主要メニュー" className="px-3 mt-4 space-y-0.5">
        {PRIMARY.map((item) => {
          const active = path === item.href || path?.startsWith(item.href + "/");
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={active ? "page" : undefined}
              onClick={onItemClick}
              className={cn(
                "group relative flex items-center gap-3 rounded-xl px-3 py-2 text-[13px] font-medium transition",
                active
                  ? "bg-[linear-gradient(180deg,rgba(186,230,253,0.45),rgba(240,249,255,0.65))] text-ink-900 [color:var(--color-ink-900)]"
                  : "text-ink-600 [color:var(--color-ink-600)] hover:bg-[var(--color-brand-50)] hover:text-ink-900"
              )}
            >
              {active && (
                <span
                  aria-hidden
                  className="absolute inset-y-1.5 left-0 w-[3px] rounded-full bg-[linear-gradient(180deg,#38BDF8,#0EA5E9)]"
                />
              )}
              <Icon
                className={cn(
                  "size-[18px] shrink-0",
                  active
                    ? "text-[var(--color-brand-600)]"
                    : "text-ink-400 [color:var(--color-ink-400)] group-hover:text-[var(--color-brand-500)]"
                )}
                strokeWidth={active ? 2.25 : 1.85}
                aria-hidden
              />
              <span className="flex-1">{item.label}</span>
              {item.badge && (
                <span className="text-[10px] font-bold text-white bg-[var(--color-brand-500)] rounded-full px-1.5 py-0.5">
                  {item.badge}
                </span>
              )}
            </Link>
          );
        })}
      </nav>

      <div className="hairline mx-5 my-4" />

      <nav aria-label="補助メニュー" className="px-3 space-y-0.5">
        {SECONDARY.map((item) => {
          const Icon = item.icon;
          const active = path?.startsWith(item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={active ? "page" : undefined}
              onClick={onItemClick}
              className="flex items-center gap-3 rounded-xl px-3 py-2 text-[12px] font-medium text-ink-500 [color:var(--color-ink-500)] hover:bg-[var(--color-brand-50)] hover:text-ink-700"
            >
              <Icon className="size-4 shrink-0" strokeWidth={1.85} aria-hidden />
              <span>{item.label}</span>
            </Link>
          );
        })}
      </nav>

      <div className="mt-auto p-3">
        <div className="rounded-2xl border border-[var(--color-brand-200)] bg-[linear-gradient(180deg,rgba(186,230,253,0.4),white)] p-4 text-[12px]">
          <div className="font-semibold text-ink-900 [color:var(--color-ink-900)] mb-1">
            自動送信の解放まで
          </div>
          <div className="text-ink-600 [color:var(--color-ink-600)] mb-3">
            人手採用率{" "}
            <span className="font-mono tabular text-[var(--color-brand-700)]">78%</span> · 残 14 日
          </div>
          <div
            role="progressbar"
            aria-valuenow={78}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label="HITL 解放まで"
            className="h-1.5 rounded-full bg-white/80 overflow-hidden"
          >
            <div
              className="h-full bg-[linear-gradient(90deg,#7DD3FC,#0EA5E9,#14B8A6)]"
              style={{ width: "78%" }}
            />
          </div>
        </div>
      </div>
    </>
  );
}

export function Sidebar() {
  return (
    <aside
      aria-label="メインナビゲーション"
      className="hidden lg:flex flex-col w-[256px] shrink-0 border-r border-[var(--color-ink-100)] bg-white/70 backdrop-blur-sm"
    >
      <div className="px-5 pt-5 pb-3">
        <Logo />
      </div>
      <NavLinks />
    </aside>
  );
}

/** モバイル / タブレット用ドロワー */
export function MobileSidebar({ open, onClose }: { open: boolean; onClose: () => void }) {
  // body スクロールを止める
  React.useEffect(() => {
    if (!open) return;
    const orig = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = orig;
    };
  }, [open]);

  // Escape で閉じる
  React.useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  return (
    <div
      className={cn(
        "fixed inset-0 z-50 lg:hidden transition-opacity",
        open ? "opacity-100 pointer-events-auto" : "opacity-0 pointer-events-none"
      )}
      aria-hidden={!open}
    >
      <button
        type="button"
        tabIndex={-1}
        aria-label="メニューを閉じる"
        onClick={onClose}
        className="absolute inset-0 bg-[rgba(11,30,63,0.45)] backdrop-blur-sm"
      />
      <aside
        role="dialog"
        aria-modal="true"
        aria-label="メインナビゲーション"
        className={cn(
          "absolute inset-y-0 left-0 w-[280px] bg-white shadow-[0_30px_70px_-20px_rgba(11,30,63,0.4)] flex flex-col transition-transform duration-200 ease-[var(--ease-glide)]",
          open ? "translate-x-0" : "-translate-x-full"
        )}
      >
        <div className="px-5 pt-5 pb-3 flex items-center justify-between">
          <Logo />
          <button
            type="button"
            onClick={onClose}
            aria-label="メニューを閉じる"
            className="size-9 grid place-content-center rounded-full border border-[var(--color-ink-200)] bg-white hover:border-[var(--color-brand-300)]"
          >
            <X className="size-4" aria-hidden />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto pb-3">
          <NavLinks onItemClick={onClose} />
        </div>
      </aside>
    </div>
  );
}
