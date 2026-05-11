"use client";

import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

interface Props {
  page: number; // 1-based
  perPage: number;
  total: number;
  hrefFor: (page: number) => string;
}

export function Pagination({ page, perPage, total, hrefFor }: Props) {
  const totalPages = Math.max(1, Math.ceil(total / perPage));
  const from = total === 0 ? 0 : (page - 1) * perPage + 1;
  const to = Math.min(page * perPage, total);
  const prev = Math.max(1, page - 1);
  const next = Math.min(totalPages, page + 1);

  return (
    <nav
      aria-label="ページネーション"
      className="flex items-center justify-between gap-4 text-[12px]"
    >
      <div className="text-ink-500 [color:var(--color-ink-500)] tabular font-mono">
        {total === 0 ? "0 件" : `${from}–${to} / ${total} 件`}
      </div>
      <div className="flex items-center gap-1.5">
        <PagerLink
          href={hrefFor(prev)}
          disabled={page <= 1}
          aria-label="前のページ"
          icon={ChevronLeft}
        />
        <span className="px-2 text-ink-600 [color:var(--color-ink-600)] tabular font-mono">
          {page} / {totalPages}
        </span>
        <PagerLink
          href={hrefFor(next)}
          disabled={page >= totalPages}
          aria-label="次のページ"
          icon={ChevronRight}
        />
      </div>
    </nav>
  );
}

function PagerLink({
  href,
  disabled,
  icon: Icon,
  ...rest
}: {
  href: string;
  disabled?: boolean;
  icon: React.ComponentType<{ className?: string; "aria-hidden"?: boolean }>;
  "aria-label"?: string;
}) {
  const cls = cn(
    "inline-flex size-8 items-center justify-center rounded-full border border-[var(--color-ink-200)] bg-white transition",
    disabled
      ? "text-ink-300 [color:var(--color-ink-300)] pointer-events-none"
      : "text-ink-700 hover:border-[var(--color-brand-300)] hover:bg-[var(--color-brand-50)]"
  );
  if (disabled) {
    return (
      <span className={cls} aria-disabled {...rest}>
        <Icon className="size-4" aria-hidden />
      </span>
    );
  }
  return (
    <Link href={href} className={cls} {...rest}>
      <Icon className="size-4" aria-hidden />
    </Link>
  );
}
