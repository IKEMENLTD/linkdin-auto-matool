import Link from "next/link";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/card";
import {
  ChevronRight,
  MessageSquare,
  Hourglass,
  ShieldAlert,
  Activity,
  type LucideIcon,
} from "lucide-react";

type AttentionKind = "review" | "warmup" | "policy" | "job";

const ICON: Record<AttentionKind, LucideIcon> = {
  review: MessageSquare,
  warmup: Hourglass,
  policy: ShieldAlert,
  job: Activity,
};

const TONE: Record<AttentionKind, string> = {
  review: "text-[var(--color-brand-700)] bg-[var(--color-brand-50)] border-[var(--color-brand-200)]",
  warmup: "text-[var(--color-warning-700)] bg-[var(--color-warning-50)] border-[#FDE68A]",
  policy: "text-[var(--color-danger-700)] bg-[var(--color-danger-50)] border-[#FECACA]",
  job: "text-[var(--color-info-700)] bg-[var(--color-info-50)] border-[#BFDBFE]",
};

export type AttentionItem = {
  id: string;
  kind: AttentionKind;
  label: string;
  count?: number;
  href: string;
  cta: string;
};

export function AttentionList({ items }: { items: AttentionItem[] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>注意が必要なもの</CardTitle>
        <span className="text-[11px] tabular font-mono text-ink-500 [color:var(--color-ink-500)]">
          {items.length} 件
        </span>
      </CardHeader>
      <CardBody className="space-y-1.5 pt-0">
        {items.length === 0 && (
          <div className="text-[12px] text-ink-400 [color:var(--color-ink-400)] py-6 text-center">
            注意が必要な項目はありません
          </div>
        )}
        {items.map((item) => {
          const Icon = ICON[item.kind];
          return (
            <Link
              key={item.id}
              href={item.href}
              className="group flex items-center gap-3 -mx-2 px-2 py-2 rounded-xl hover:bg-[var(--color-brand-50)]/60 transition"
            >
              <span
                className={`grid place-content-center size-8 rounded-lg border ${TONE[item.kind]}`}
              >
                <Icon className="size-4" strokeWidth={2} aria-hidden />
              </span>
              <div className="flex-1 min-w-0">
                <div className="text-[13px] font-medium text-ink-900 [color:var(--color-ink-900)] truncate">
                  {item.label}
                </div>
                <div className="text-[11px] text-ink-500 [color:var(--color-ink-500)]">
                  {item.cta}
                </div>
              </div>
              {item.count !== undefined && (
                <span
                  aria-label={`${item.count} 件`}
                  className="font-mono tabular text-[12px] font-semibold text-[var(--color-brand-700)]"
                >
                  {item.count}
                </span>
              )}
              <ChevronRight
                className="size-4 text-ink-300 [color:var(--color-ink-300)] group-hover:text-[var(--color-brand-500)] transition"
                aria-hidden
              />
            </Link>
          );
        })}
      </CardBody>
    </Card>
  );
}
