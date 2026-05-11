"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

interface DropdownProps {
  /** trigger は ReactNode (描画) として渡し、内部で `<button>` でラップする */
  trigger: React.ReactNode;
  triggerProps?: Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, "onClick" | "aria-haspopup" | "aria-expanded">;
  triggerClassName?: string;
  triggerAriaLabel?: string;
  children: (close: () => void) => React.ReactNode;
  align?: "start" | "end";
  className?: string;
}

/**
 * 軽量 dropdown。Radix 不使用、Escape / 外クリック / focus trap 基本対応。
 * 本格的なメニューは shadcn/ui の Radix 版に置換予定。
 */
export function Dropdown({
  trigger,
  triggerProps,
  triggerClassName,
  triggerAriaLabel,
  children,
  align = "end",
  className,
}: DropdownProps) {
  const [open, setOpen] = React.useState(false);
  const ref = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("mousedown", onClick);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onClick);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={ref} className="relative inline-block">
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={triggerAriaLabel}
        onClick={() => setOpen((v) => !v)}
        className={cn("inline-flex items-center", triggerClassName)}
        {...triggerProps}
      >
        {trigger}
      </button>
      {open && (
        <div
          role="menu"
          className={cn(
            "absolute z-40 mt-2 min-w-[200px] rounded-xl border border-[var(--color-ink-200)] bg-white shadow-[var(--shadow-popover)] p-1",
            align === "end" ? "right-0" : "left-0",
            className
          )}
        >
          {children(() => setOpen(false))}
        </div>
      )}
    </div>
  );
}

export function DropdownItem({
  children,
  onSelect,
  disabled,
  destructive,
  icon: Icon,
}: {
  children: React.ReactNode;
  onSelect?: () => void;
  disabled?: boolean;
  destructive?: boolean;
  icon?: React.ComponentType<{ className?: string; "aria-hidden"?: boolean }>;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      disabled={disabled}
      onClick={() => !disabled && onSelect?.()}
      className={cn(
        "flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-[13px] text-ink-700 [color:var(--color-ink-700)]",
        "hover:bg-[var(--color-brand-50)] hover:text-ink-900",
        destructive && "text-[var(--color-danger-700)] hover:bg-[var(--color-danger-50)]",
        disabled && "opacity-50 pointer-events-none"
      )}
    >
      {Icon && <Icon className="size-3.5" aria-hidden />}
      {children}
    </button>
  );
}

export function DropdownDivider() {
  return <div role="separator" className="my-1 h-px bg-[var(--color-ink-100)]" />;
}
