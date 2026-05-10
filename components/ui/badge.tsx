import * as React from "react";
import { cn } from "@/lib/utils";

type Tone = "info" | "success" | "warning" | "danger" | "neutral" | "brand";

const toneClass: Record<Tone, string> = {
  info: "bg-[var(--color-info-50)] text-[var(--color-info-700)] border-[#BFDBFE]",
  brand: "bg-[var(--color-brand-50)] text-[var(--color-brand-700)] border-[var(--color-brand-200)]",
  success: "bg-[var(--color-success-50)] text-[var(--color-success-700)] border-[#A7F3D0]",
  warning: "bg-[var(--color-warning-50)] text-[var(--color-warning-700)] border-[#FDE68A]",
  danger: "bg-[var(--color-danger-50)] text-[var(--color-danger-700)] border-[#FECACA]",
  neutral: "bg-[var(--color-ink-50)] text-[var(--color-ink-700)] border-[var(--color-ink-200)]",
};

export function Badge({
  tone = "neutral",
  className,
  children,
  ...rest
}: React.HTMLAttributes<HTMLSpanElement> & { tone?: Tone }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium",
        toneClass[tone],
        className
      )}
      {...rest}
    >
      {children}
    </span>
  );
}
