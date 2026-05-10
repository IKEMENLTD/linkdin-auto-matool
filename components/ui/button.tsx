import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const buttonStyles = cva(
  [
    "relative inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-full font-medium",
    "transition-[transform,box-shadow,background-color,color] duration-200 ease-[var(--ease-glide)]",
    "disabled:pointer-events-none disabled:opacity-50",
    "focus-visible:outline-none",
  ],
  {
    variants: {
      variant: {
        primary: [
          "text-white shadow-[0_8px_24px_-12px_rgba(14,165,233,0.55)]",
          "bg-[linear-gradient(180deg,#38BDF8_0%,#0EA5E9_55%,#0284C7_100%)]",
          "hover:translate-y-[-1px] hover:shadow-[0_14px_28px_-14px_rgba(14,165,233,0.65)]",
          "active:translate-y-0 active:shadow-[0_4px_10px_-6px_rgba(14,165,233,0.55)]",
        ],
        secondary: [
          "bg-white text-ink-900 border border-[var(--color-ink-200)]",
          "hover:border-[var(--color-brand-300)] hover:bg-[var(--color-brand-50)]",
        ],
        ghost: [
          "bg-transparent text-ink-700 hover:bg-[var(--color-brand-50)] hover:text-ink-900",
        ],
        danger: [
          "bg-[var(--color-danger-500)] text-white",
          "hover:bg-[var(--color-danger-700)]",
        ],
        link: [
          "text-[var(--color-brand-700)] underline-offset-4 hover:underline rounded-md px-0",
        ],
      },
      size: {
        sm: "h-8 px-3 text-xs",
        md: "h-10 px-4 text-sm",
        lg: "h-12 px-6 text-base",
        icon: "h-9 w-9 p-0",
      },
    },
    defaultVariants: { variant: "primary", size: "md" },
  }
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonStyles> {
  loading?: boolean;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, loading, children, disabled, ...props }, ref) => (
    <button
      ref={ref}
      className={cn(buttonStyles({ variant, size }), className)}
      disabled={disabled || loading}
      {...props}
    >
      {loading && (
        <span
          aria-hidden
          className="size-3.5 rounded-full border-2 border-current border-r-transparent animate-spin"
        />
      )}
      {children}
    </button>
  )
);
Button.displayName = "Button";
