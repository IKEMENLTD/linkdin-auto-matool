"use client";

import { Globe, Sparkles } from "lucide-react";
import { Input } from "@/components/ui/input";
import { TagInput } from "@/components/ui/tag-input";
import type { Step2 } from "@/lib/wizard-schema";

interface Props {
  value: Partial<Step2>;
  onChange: (next: Partial<Step2>) => void;
  errors?: Record<string, string>;
}

export function StepProduct({ value, onChange, errors }: Props) {
  return (
    <div className="space-y-5">
      <Field
        label="製品 / 会社 URL"
        hint="任意。入力すると AI が概要・強みを抽出します (Phase2)"
        error={errors?.productUrl}
      >
        <div className="flex gap-2">
          <div className="relative flex-1">
            <Globe
              className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-ink-400 [color:var(--color-ink-400)]"
              aria-hidden
            />
            <Input
              type="url"
              value={value.productUrl ?? ""}
              onChange={(e) => onChange({ productUrl: e.target.value })}
              placeholder="https://example.com"
              className="pl-9"
              aria-invalid={!!errors?.productUrl}
            />
          </div>
          <button
            type="button"
            disabled
            title="Phase2 で実装予定"
            className="inline-flex items-center gap-1 h-10 px-3 rounded-xl border border-[var(--color-ink-200)] bg-[var(--color-ink-50)] text-ink-400 text-[12px] cursor-not-allowed"
          >
            <Sparkles className="size-3.5" aria-hidden /> AI 取り込み
          </button>
        </div>
      </Field>

      <Field label="会社名" required error={errors?.companyName}>
        <Input
          value={value.companyName ?? ""}
          onChange={(e) => onChange({ companyName: e.target.value })}
          placeholder="株式会社 ◯◯"
          aria-invalid={!!errors?.companyName}
        />
      </Field>

      <Field
        label="製品概要"
        hint="20〜400 文字。AI メッセージ生成に使われます"
        required
        error={errors?.productSummary}
        counter={`${(value.productSummary ?? "").length} / 400`}
      >
        <textarea
          value={value.productSummary ?? ""}
          onChange={(e) => onChange({ productSummary: e.target.value })}
          rows={4}
          maxLength={400}
          placeholder="営業担当者の業務時間を 30% 削減する、AI 駆動の SDR エージェントです。日本語 B2B に最適化。"
          className="block w-full px-3 py-2 rounded-xl border border-[var(--color-ink-200)] bg-white text-[14px] text-ink-900 placeholder:text-ink-400 focus:border-[var(--color-brand-500)] transition resize-none"
          aria-invalid={!!errors?.productSummary}
        />
      </Field>

      <Field label="強み (任意 / 最大 5 件)" error={errors?.strengths}>
        <TagInput
          value={value.strengths ?? []}
          onChange={(strengths) => onChange({ strengths })}
          max={5}
          maxLen={60}
          placeholder="日本語の自然さ / 導入工数 1 日 / SOC2 準拠 …"
          ariaLabel="強みタグ"
        />
      </Field>
    </div>
  );
}

function Field({
  label,
  hint,
  required,
  error,
  counter,
  children,
}: {
  label: string;
  hint?: string;
  required?: boolean;
  error?: string;
  counter?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <div className="flex items-center justify-between mb-1.5">
        <span className="text-[12px] font-medium text-ink-700 [color:var(--color-ink-700)]">
          {label}
          {required && <span className="text-[var(--color-danger-700)] ml-0.5">*</span>}
        </span>
        {counter && (
          <span className="text-[10px] tabular font-mono text-ink-400 [color:var(--color-ink-400)]">
            {counter}
          </span>
        )}
      </div>
      {children}
      {hint && !error && (
        <div className="mt-1 text-[11px] text-ink-500 [color:var(--color-ink-500)]">
          {hint}
        </div>
      )}
      {error && (
        <div role="alert" className="mt-1 text-[11px] text-[var(--color-danger-700)]">
          {error}
        </div>
      )}
    </label>
  );
}
