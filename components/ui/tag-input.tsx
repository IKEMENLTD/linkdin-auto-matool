"use client";

import * as React from "react";
import { X, Plus } from "lucide-react";
import { cn } from "@/lib/utils";

interface Props {
  value: string[];
  onChange: (next: string[]) => void;
  placeholder?: string;
  max?: number;
  maxLen?: number;
  ariaLabel?: string;
  className?: string;
}

export function TagInput({
  value,
  onChange,
  placeholder = "Enter / カンマで追加",
  max = 20,
  maxLen = 80,
  ariaLabel,
  className,
}: Props) {
  const [draft, setDraft] = React.useState("");
  const inputRef = React.useRef<HTMLInputElement>(null);

  const commit = (raw: string) => {
    const item = raw.trim().slice(0, maxLen);
    if (!item) return;
    if (value.includes(item)) return;
    if (value.length >= max) return;
    onChange([...value, item]);
    setDraft("");
  };

  const remove = (idx: number) => {
    const next = value.slice();
    next.splice(idx, 1);
    onChange(next);
  };

  return (
    <div
      role="group"
      aria-label={ariaLabel}
      onClick={() => inputRef.current?.focus()}
      className={cn(
        "flex flex-wrap items-center gap-1.5 min-h-10 px-2 py-1.5 rounded-xl border border-[var(--color-ink-200)] bg-white focus-within:border-[var(--color-brand-500)] transition cursor-text",
        className
      )}
    >
      {value.map((tag, idx) => (
        <span
          key={`${tag}-${idx}`}
          className="inline-flex items-center gap-1 rounded-full bg-[var(--color-brand-50)] border border-[var(--color-brand-200)] text-[var(--color-brand-700)] text-[12px] px-2 py-0.5"
        >
          {tag}
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              remove(idx);
            }}
            aria-label={`${tag} を削除`}
            className="size-4 grid place-content-center rounded-full hover:bg-white text-[var(--color-brand-700)]"
          >
            <X className="size-3" aria-hidden />
          </button>
        </span>
      ))}
      <input
        ref={inputRef}
        type="text"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === ",") {
            e.preventDefault();
            commit(draft);
          } else if (e.key === "Backspace" && draft === "" && value.length > 0) {
            remove(value.length - 1);
          }
        }}
        onBlur={() => commit(draft)}
        placeholder={value.length === 0 ? placeholder : ""}
        className="flex-1 min-w-[120px] bg-transparent text-[13px] text-ink-900 placeholder:text-ink-400 outline-none"
      />
      {draft.trim() && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            commit(draft);
          }}
          className="text-[var(--color-brand-700)] inline-flex items-center gap-1 text-[11px]"
        >
          <Plus className="size-3" aria-hidden /> 追加
        </button>
      )}
    </div>
  );
}
