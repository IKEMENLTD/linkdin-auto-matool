"use client";

import { Target, Calendar, UserPlus, Microscope } from "lucide-react";
import { OBJECTIVES, OBJECTIVE_META, type Objective } from "@/lib/wizard-schema";
import { cn } from "@/lib/utils";

const ICONS = {
  outbound: Target,
  event: Calendar,
  hiring: UserPlus,
  research: Microscope,
} as const;

interface Props {
  value?: Objective;
  onChange: (v: Objective) => void;
}

export function StepObjective({ value, onChange }: Props) {
  const handleKey = (e: React.KeyboardEvent<HTMLInputElement>, current: Objective) => {
    const idx = OBJECTIVES.indexOf(current);
    if (idx < 0) return;
    let nextIdx = idx;
    if (e.key === "ArrowRight" || e.key === "ArrowDown") nextIdx = (idx + 1) % OBJECTIVES.length;
    else if (e.key === "ArrowLeft" || e.key === "ArrowUp") nextIdx = (idx - 1 + OBJECTIVES.length) % OBJECTIVES.length;
    else return;
    e.preventDefault();
    onChange(OBJECTIVES[nextIdx]);
  };
  return (
    <fieldset className="grid grid-cols-1 sm:grid-cols-2 gap-3">
      <legend className="sr-only">キャンペーン目的</legend>
      {OBJECTIVES.map((o) => {
        const Icon = ICONS[o];
        const meta = OBJECTIVE_META[o];
        const active = value === o;
        return (
          <label
            key={o}
            className={cn(
              "relative flex items-start gap-3 p-4 rounded-2xl border bg-white cursor-pointer transition peer-focus-visible:ring-2 peer-focus-visible:ring-[var(--color-brand-400)]",
              active
                ? "border-[var(--color-brand-500)] shadow-[0_8px_24px_-16px_rgba(14,165,233,0.55)] bg-[linear-gradient(180deg,rgba(240,249,255,0.6),white)]"
                : "border-[var(--color-ink-200)] hover:border-[var(--color-brand-300)] hover:bg-[var(--color-brand-50)]/40"
            )}
          >
            <input
              type="radio"
              name="objective"
              value={o}
              checked={active}
              onChange={() => onChange(o)}
              onKeyDown={(e) => handleKey(e, o)}
              className="sr-only peer focus-visible:outline-none"
            />
            <span
              aria-hidden
              className={cn(
                "size-10 shrink-0 grid place-content-center rounded-xl border",
                active
                  ? "border-[var(--color-brand-300)] bg-[var(--color-brand-50)] text-[var(--color-brand-700)]"
                  : "border-[var(--color-ink-200)] text-ink-500 [color:var(--color-ink-500)]"
              )}
            >
              <Icon className="size-5" />
            </span>
            <div className="min-w-0">
              <div className="font-display text-[15px] font-semibold text-ink-900 [color:var(--color-ink-900)]">
                {meta.ja}
              </div>
              <div className="text-[12px] text-ink-500 [color:var(--color-ink-500)] mt-0.5">
                {meta.desc}
              </div>
            </div>
            {active && (
              <span className="absolute top-3 right-3 size-2 rounded-full bg-[var(--color-brand-500)]" />
            )}
          </label>
        );
      })}
    </fieldset>
  );
}
