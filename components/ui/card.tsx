import * as React from "react";
import { cn } from "@/lib/utils";

export const Card = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement> & { variant?: "solid" | "glass" }
>(({ className, variant = "solid", ...props }, ref) => (
  <div
    ref={ref}
    className={cn(
      "rounded-[var(--radius-lg)]",
      variant === "solid" && "card-solid",
      variant === "glass" && "glass",
      className
    )}
    {...props}
  />
));
Card.displayName = "Card";

export const CardHeader = ({ className, ...p }: React.HTMLAttributes<HTMLDivElement>) => (
  <div className={cn("p-5 pb-3 flex items-start justify-between gap-3", className)} {...p} />
);

export const CardTitle = ({ className, ...p }: React.HTMLAttributes<HTMLDivElement>) => (
  <div className={cn("text-sm font-medium text-ink-700 [color:var(--color-ink-700)]", className)} {...p} />
);

export const CardBody = ({ className, ...p }: React.HTMLAttributes<HTMLDivElement>) => (
  <div className={cn("px-5 pb-5", className)} {...p} />
);

export const CardFooter = ({ className, ...p }: React.HTMLAttributes<HTMLDivElement>) => (
  <div
    className={cn(
      "px-5 py-3 border-t border-[var(--color-ink-100)] text-xs text-ink-500 [color:var(--color-ink-500)] flex items-center justify-between",
      className
    )}
    {...p}
  />
);
