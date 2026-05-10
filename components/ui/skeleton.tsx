import * as React from "react";
import { cn } from "@/lib/utils";

export function Skeleton({ className, ...rest }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      aria-hidden
      className={cn(
        "rounded-md bg-[linear-gradient(90deg,var(--color-brand-50),var(--color-ink-100),var(--color-brand-50))] bg-[length:200%_100%] shimmer",
        className
      )}
      {...rest}
    />
  );
}
