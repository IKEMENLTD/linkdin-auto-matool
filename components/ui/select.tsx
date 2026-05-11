"use client";

import * as React from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

interface Option {
  value: string;
  label: string;
}

interface Props
  extends Omit<React.SelectHTMLAttributes<HTMLSelectElement>, "size"> {
  options: Option[];
  placeholder?: string;
  size?: "sm" | "md";
}

export const Select = React.forwardRef<HTMLSelectElement, Props>(
  ({ options, placeholder, className, size = "md", value, ...rest }, ref) => (
    <span className="relative inline-block">
      <select
        ref={ref}
        value={value}
        className={cn(
          "appearance-none rounded-full border border-[var(--color-ink-200)] bg-white pr-8 pl-3.5 text-ink-700 [color:var(--color-ink-700)]",
          "hover:border-[var(--color-brand-300)] focus:border-[var(--color-brand-500)] transition",
          size === "sm" ? "h-8 text-[12px]" : "h-9 text-[13px]",
          className
        )}
        {...rest}
      >
        {placeholder && (
          <option value="" disabled={value !== ""}>
            {placeholder}
          </option>
        )}
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      <ChevronDown
        className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 size-3.5 text-ink-400 [color:var(--color-ink-400)]"
        aria-hidden
      />
    </span>
  )
);
Select.displayName = "Select";
