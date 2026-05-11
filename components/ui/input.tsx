import * as React from "react";
import { cn } from "@/lib/utils";

export const Input = React.forwardRef<
  HTMLInputElement,
  React.InputHTMLAttributes<HTMLInputElement>
>(({ className, type = "text", ...rest }, ref) => (
  <input
    ref={ref}
    type={type}
    className={cn(
      "block w-full h-10 px-3 rounded-xl border border-[var(--color-ink-200)] bg-white",
      "text-[14px] text-ink-900 placeholder:text-ink-400 transition",
      "focus:border-[var(--color-brand-500)]",
      "disabled:bg-[var(--color-ink-50)] disabled:text-ink-400 disabled:cursor-not-allowed",
      className
    )}
    {...rest}
  />
));
Input.displayName = "Input";
