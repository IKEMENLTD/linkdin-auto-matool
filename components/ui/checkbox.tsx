"use client";

import * as React from "react";
import { Check, Minus } from "lucide-react";
import { cn } from "@/lib/utils";

interface Props
  extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, "onChange" | "value"> {
  checked: boolean | "indeterminate";
  onCheckedChange?: (next: boolean) => void;
  label?: string;
}

export const Checkbox = React.forwardRef<HTMLButtonElement, Props>(
  ({ checked, onCheckedChange, className, label, ...rest }, ref) => {
    const indeterminate = checked === "indeterminate";
    const isChecked = checked === true;
    return (
      <button
        ref={ref}
        type="button"
        role="checkbox"
        aria-checked={indeterminate ? "mixed" : isChecked}
        aria-label={label}
        onClick={(e) => {
          e.stopPropagation();
          onCheckedChange?.(!isChecked);
        }}
        className={cn(
          "inline-flex size-[18px] shrink-0 items-center justify-center rounded-[5px] border transition",
          "border-[var(--color-ink-300)] bg-white hover:border-[var(--color-brand-500)]",
          (isChecked || indeterminate) &&
            "border-[var(--color-brand-500)] bg-[var(--color-brand-500)] text-white hover:bg-[var(--color-brand-600)]",
          className
        )}
        {...rest}
      >
        {indeterminate ? (
          <Minus className="size-3" strokeWidth={3} aria-hidden />
        ) : isChecked ? (
          <Check className="size-3" strokeWidth={3} aria-hidden />
        ) : null}
      </button>
    );
  }
);
Checkbox.displayName = "Checkbox";
