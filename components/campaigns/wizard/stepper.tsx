"use client";

import * as React from "react";
import { Check } from "lucide-react";
import { STEPS, type StepId } from "@/lib/wizard-schema";
import { cn } from "@/lib/utils";

interface Props {
  current: StepId;
  furthest: StepId;
  onJump?: (step: StepId) => void;
}

export function Stepper({ current, furthest, onJump }: Props) {
  return (
    <ol
      role="list"
      aria-label="ウィザード進捗"
      className="flex items-center gap-1 sm:gap-2 overflow-x-auto"
    >
      {STEPS.map((s, idx) => {
        const isCurrent = current === s.id;
        const isPast = s.id < current || (furthest >= s.id && !isCurrent);
        const isReachable = s.id <= furthest;
        return (
          <li key={s.id} className="flex items-center gap-1 sm:gap-2 shrink-0">
            <StepNode
              id={s.id}
              label={s.label}
              isCurrent={isCurrent}
              isPast={isPast}
              isReachable={isReachable}
              onJump={onJump}
            />
            {idx < STEPS.length - 1 && (
              <span
                aria-hidden
                className={cn(
                  "h-px w-4 sm:w-6 bg-[var(--color-ink-200)]",
                  isPast && "bg-[var(--color-brand-300)]"
                )}
              />
            )}
          </li>
        );
      })}
    </ol>
  );
}

interface NodeProps {
  id: StepId;
  label: string;
  isCurrent: boolean;
  isPast: boolean;
  isReachable: boolean;
  onJump?: (s: StepId) => void;
}

function StepNode({ id, label, isCurrent, isPast, isReachable, onJump }: NodeProps) {
  const cls = cn(
    "inline-flex items-center gap-2 rounded-full px-2.5 py-1.5 text-[12px] transition",
    isCurrent &&
      "bg-[linear-gradient(180deg,rgba(186,230,253,0.55),rgba(240,249,255,0.7))] border border-[var(--color-brand-200)] font-semibold text-[var(--color-brand-800)]",
    !isCurrent &&
      isReachable &&
      "text-ink-700 hover:bg-[var(--color-brand-50)] [color:var(--color-ink-700)]",
    !isReachable && "text-ink-400 [color:var(--color-ink-400)]"
  );
  const inside = (
    <>
      <span
        aria-hidden
        className={cn(
          "inline-flex size-5 items-center justify-center rounded-full text-[10px] font-bold tabular font-mono",
          isPast
            ? "bg-[var(--color-brand-500)] text-white"
            : isCurrent
            ? "bg-white border border-[var(--color-brand-500)] text-[var(--color-brand-700)]"
            : "bg-[var(--color-ink-100)] text-ink-500 [color:var(--color-ink-500)]"
        )}
      >
        {isPast ? <Check className="size-3" /> : id}
      </span>
      <span className="whitespace-nowrap">{label}</span>
    </>
  );

  if (onJump && isReachable && !isCurrent) {
    return (
      <button
        type="button"
        onClick={() => onJump(id)}
        aria-label={`Step ${id} (${label}) へ移動`}
        className={cls}
      >
        {inside}
      </button>
    );
  }
  return (
    <span aria-current={isCurrent ? "step" : undefined} className={cls}>
      {inside}
    </span>
  );
}
