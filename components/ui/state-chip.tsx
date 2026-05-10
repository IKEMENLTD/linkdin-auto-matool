import * as React from "react";
import { STATE_META, TONE_CLASS, type LeadState } from "@/lib/state-machine";
import { cn } from "@/lib/utils";

interface Props extends React.HTMLAttributes<HTMLSpanElement> {
  state: LeadState;
  size?: "sm" | "md";
  showLabel?: boolean;
}

export function StateChip({ state, size = "sm", showLabel = true, className, ...rest }: Props) {
  const meta = STATE_META[state];
  const Icon = meta.icon;
  return (
    <span
      role="status"
      aria-label={meta.ja}
      className={cn(
        "chip",
        TONE_CLASS[meta.tone],
        size === "sm" ? "text-[11px] py-0.5 px-2" : "text-xs py-1 px-2.5",
        className
      )}
      {...rest}
    >
      <Icon aria-hidden className={size === "sm" ? "size-3" : "size-3.5"} strokeWidth={2.25} />
      {showLabel && <span>{meta.ja}</span>}
    </span>
  );
}
