"use client";

import { AlertTriangle, AlertOctagon, Sparkles } from "lucide-react";
import { Input } from "@/components/ui/input";
import { TagInput } from "@/components/ui/tag-input";
import { fmtNumber } from "@/lib/formatters";
import {
  estimateReach,
  REGIONS,
  FUNDING_STAGES,
  type Step3,
  type Region,
  type FundingStage,
} from "@/lib/wizard-schema";

const REGION_LABELS: Record<Region, string> = {
  jp: "日本",
  global: "グローバル",
  us: "米国",
  eu: "EU",
};

const FUNDING_LABELS: Record<FundingStage, string> = {
  seed: "Seed",
  a: "Series A",
  b: "Series B",
  c: "Series C",
  ipo: "IPO 済",
};

interface Props {
  value: Partial<Step3>;
  onChange: (next: Partial<Step3>) => void;
  errors?: Record<string, string>;
}

export function StepIcp({ value, onChange, errors }: Props) {
  const merged: Step3 = {
    jobTitles: value.jobTitles ?? [],
    industries: value.industries ?? [],
    headcountMin: value.headcountMin ?? 10,
    headcountMax: value.headcountMax ?? 10000,
    regions: value.regions ?? ["jp"],
    funding: value.funding ?? [],
    customQuery: value.customQuery ?? "",
  };
  const reach = estimateReach(merged);

  return (
    <div className="space-y-5">
      <Field label="ターゲット役職" required error={errors?.jobTitles}>
        <TagInput
          value={merged.jobTitles}
          onChange={(jobTitles) => onChange({ jobTitles })}
          placeholder="VP of Engineering, CTO, VPoE …"
          ariaLabel="ターゲット役職"
        />
      </Field>

      <Field label="業界 (任意)" error={errors?.industries}>
        <TagInput
          value={merged.industries}
          onChange={(industries) => onChange({ industries })}
          placeholder="SaaS, Fintech, Manufacturing …"
          ariaLabel="業界"
        />
      </Field>

      <div className="grid sm:grid-cols-2 gap-4">
        <Field label="従業員規模 (最小)">
          <Input
            type="number"
            value={merged.headcountMin}
            min={0}
            max={1_000_000}
            onChange={(e) =>
              onChange({ headcountMin: Math.max(0, Number(e.target.value) || 0) })
            }
          />
        </Field>
        <Field label="従業員規模 (最大)">
          <Input
            type="number"
            value={merged.headcountMax}
            min={0}
            max={1_000_000}
            onChange={(e) =>
              onChange({ headcountMax: Math.max(0, Number(e.target.value) || 0) })
            }
          />
        </Field>
      </div>

      <Field label="地域 (複数選択可)">
        <div role="group" aria-label="地域" className="flex flex-wrap gap-1.5">
          {REGIONS.map((r) => {
            const checked = merged.regions.includes(r);
            return (
              <button
                key={r}
                type="button"
                aria-pressed={checked}
                onClick={() => {
                  const set = new Set<Region>(merged.regions);
                  if (set.has(r)) set.delete(r);
                  else set.add(r);
                  if (set.size === 0) set.add("jp");
                  onChange({ regions: Array.from(set) });
                }}
                className={
                  checked
                    ? "inline-flex items-center gap-1 rounded-full px-3 py-1 text-[12px] border border-[var(--color-brand-500)] bg-[var(--color-brand-50)] text-[var(--color-brand-700)] font-medium"
                    : "inline-flex items-center gap-1 rounded-full px-3 py-1 text-[12px] border border-[var(--color-ink-200)] bg-white text-ink-700 [color:var(--color-ink-700)] hover:border-[var(--color-brand-300)]"
                }
              >
                {REGION_LABELS[r]}
              </button>
            );
          })}
        </div>
      </Field>

      <Field label="資金調達ステージ (任意)">
        <div role="group" aria-label="資金調達" className="flex flex-wrap gap-1.5">
          {FUNDING_STAGES.map((f) => {
            const checked = merged.funding.includes(f);
            return (
              <button
                key={f}
                type="button"
                aria-pressed={checked}
                onClick={() => {
                  const set = new Set<FundingStage>(merged.funding);
                  if (set.has(f)) set.delete(f);
                  else set.add(f);
                  onChange({ funding: Array.from(set) });
                }}
                className={
                  checked
                    ? "inline-flex items-center gap-1 rounded-full px-3 py-1 text-[12px] border border-[var(--color-brand-500)] bg-[var(--color-brand-50)] text-[var(--color-brand-700)] font-medium"
                    : "inline-flex items-center gap-1 rounded-full px-3 py-1 text-[12px] border border-[var(--color-ink-200)] bg-white text-ink-700 [color:var(--color-ink-700)] hover:border-[var(--color-brand-300)]"
                }
              >
                {FUNDING_LABELS[f]}
              </button>
            );
          })}
        </div>
      </Field>

      <Field
        label="LinkedIn 検索式 (任意・上級者向け)"
        hint={`例: title:(VPoE OR "VP of Engineering") AND company_size:[51 TO 500]`}
      >
        <Input
          value={merged.customQuery}
          onChange={(e) => onChange({ customQuery: e.target.value })}
          placeholder={`title:("VPoE" OR "VP of Engineering")`}
        />
      </Field>

      <ReachIndicator reach={reach} />
    </div>
  );
}

function ReachIndicator({ reach }: { reach: number }) {
  if (reach === 0) {
    return (
      <div className="rounded-xl border border-[var(--color-ink-200)] bg-[var(--color-ink-50)] px-4 py-3 text-[12px] text-ink-500 [color:var(--color-ink-500)] flex items-center gap-2">
        <Sparkles className="size-3.5" aria-hidden />
        役職を入力すると、推定リーチを計算します。
      </div>
    );
  }
  const danger = reach < 50 || reach > 100_000;
  if (danger && reach < 50) {
    return (
      <div
        role="alert"
        className="rounded-xl border border-[#FDE68A] bg-[var(--color-warning-50)] px-4 py-3 text-[12px] text-[var(--color-warning-700)] flex items-start gap-2"
      >
        <AlertTriangle className="size-4 mt-0.5 shrink-0" aria-hidden />
        <div>
          <div className="font-medium">推定リーチ: 約 {fmtNumber(reach)} 件</div>
          <div className="mt-0.5">
            条件が厳しすぎます。役職や業界を増やすか、地域を広げる事を推奨します。
          </div>
        </div>
      </div>
    );
  }
  if (danger && reach > 100_000) {
    return (
      <div
        role="alert"
        className="rounded-xl border border-[#FECACA] bg-[var(--color-danger-50)] px-4 py-3 text-[12px] text-[var(--color-danger-700)] flex items-start gap-2"
      >
        <AlertOctagon className="size-4 mt-0.5 shrink-0" aria-hidden />
        <div>
          <div className="font-medium">推定リーチ: 約 {fmtNumber(reach)} 件</div>
          <div className="mt-0.5">
            広すぎます。役職を絞り込むか、業界 / 地域 / 規模を限定してください。
          </div>
        </div>
      </div>
    );
  }
  return (
    <div className="rounded-xl border border-[var(--color-brand-200)] bg-[linear-gradient(180deg,rgba(240,249,255,0.6),white)] px-4 py-3 text-[12px] text-ink-700 [color:var(--color-ink-700)] flex items-center justify-between gap-2">
      <span className="inline-flex items-center gap-1.5">
        <Sparkles className="size-3.5 text-[var(--color-brand-600)]" aria-hidden />
        推定リーチ
      </span>
      <span className="font-mono tabular text-[15px] font-semibold text-[var(--color-brand-700)]">
        {fmtNumber(reach)} 件
      </span>
    </div>
  );
}

function Field({
  label,
  hint,
  required,
  error,
  children,
}: {
  label: string;
  hint?: string;
  required?: boolean;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="text-[12px] font-medium text-ink-700 [color:var(--color-ink-700)] block mb-1.5">
        {label}
        {required && <span className="text-[var(--color-danger-700)] ml-0.5">*</span>}
      </span>
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
