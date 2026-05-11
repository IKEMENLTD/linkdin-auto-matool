import Link from "next/link";
import type { LucideIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface Props {
  icon: LucideIcon;
  title: string;
  description?: string;
  primary?: { label: string; href: string };
  secondary?: { label: string; href: string };
  className?: string;
}

export function EmptyState({
  icon: Icon,
  title,
  description,
  primary,
  secondary,
  className,
}: Props) {
  return (
    <div
      role="status"
      className={cn(
        "rounded-[var(--radius-2xl)] border border-dashed border-[var(--color-brand-200)] bg-[linear-gradient(180deg,rgba(240,249,255,0.4),white)] px-6 py-12 text-center",
        className
      )}
    >
      <div className="inline-flex items-center justify-center size-14 rounded-2xl border border-[var(--color-brand-200)] bg-[var(--color-brand-50)] text-[var(--color-brand-700)] mb-4">
        <Icon className="size-6" aria-hidden />
      </div>
      <h2 className="font-display text-[20px] font-bold tracking-tight text-ink-900 [color:var(--color-ink-900)] mb-1.5">
        {title}
      </h2>
      {description && (
        <p className="text-[13px] text-ink-600 [color:var(--color-ink-600)] mb-5 max-w-[420px] mx-auto leading-relaxed">
          {description}
        </p>
      )}
      {(primary || secondary) && (
        <div className="inline-flex items-center justify-center gap-2">
          {primary && (
            <Link href={primary.href}>
              <Button>{primary.label}</Button>
            </Link>
          )}
          {secondary && (
            <Link href={secondary.href}>
              <Button variant="secondary">{secondary.label}</Button>
            </Link>
          )}
        </div>
      )}
    </div>
  );
}
