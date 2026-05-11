"use client";

import { Hourglass, ShieldAlert } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import {
  REVIEW_MODES,
  WARMUP_DAILY_CAP_BY_DAY,
  type ReviewMode,
  type Step5,
} from "@/lib/wizard-schema";

const REVIEW_MODE_LABEL: Record<ReviewMode, { ja: string; desc: string }> = {
  review_required: {
    ja: "レビュー必須 (推奨)",
    desc: "AI が下書きを生成し、担当者が確認してから送信",
  },
  semi_auto: {
    ja: "セミ自動",
    desc: "信頼閾値を超えたメッセージのみ自動送信。Owner 同意が必要",
  },
};

export interface AccountOption {
  id: string;
  name: string;
  warmupDay: number;
  status: "active" | "warming" | "safe_mode";
}

interface Props {
  value: Partial<Step5>;
  accounts: AccountOption[];
  onChange: (next: Partial<Step5>) => void;
  errors?: Record<string, string>;
}

export function StepDelivery({ value, accounts, onChange, errors }: Props) {
  const accountIds = value.accountIds ?? [];
  const dailyLimit = value.dailyLimit ?? 25;
  const startTime = value.startTime ?? "09:00";
  const endTime = value.endTime ?? "18:00";
  const weekdaysOnly = value.weekdaysOnly ?? true;
  const reviewMode = (value.reviewMode ?? "review_required") as ReviewMode;
  const consent = Boolean(value.consentPolicy);
  const startsAt = value.startsAt ?? "";

  const selected = accounts.filter((a) => accountIds.includes(a.id));
  const minWarmupCap = Math.min(
    ...(selected.length > 0
      ? selected.map((a) => WARMUP_DAILY_CAP_BY_DAY(a.warmupDay))
      : [25])
  );
  const overWarmup = selected.length > 0 && dailyLimit > minWarmupCap;

  return (
    <div className="space-y-5">
      <Field
        label="担当アカウント"
        required
        hint="ウォームアップ中のアカウントは安全上限が自動で適用されます"
        error={errors?.accountIds}
      >
        <div className="space-y-2">
          {accounts.length === 0 ? (
            <div className="text-[12px] text-ink-500 [color:var(--color-ink-500)] rounded-xl border border-dashed border-[var(--color-ink-200)] px-3 py-4 text-center">
              アカウントが接続されていません。
              <a className="text-[var(--color-brand-700)] hover:underline" href="/connections/linkedin">
                接続管理
              </a>
              でアカウントを追加してください。
            </div>
          ) : (
            accounts.map((a) => {
              const checked = accountIds.includes(a.id);
              const safe = a.status === "safe_mode";
              const cap = WARMUP_DAILY_CAP_BY_DAY(a.warmupDay);
              return (
                <label
                  key={a.id}
                  className={
                    safe
                      ? "flex items-center gap-3 rounded-xl border border-[#FECACA] bg-[var(--color-danger-50)] px-3 py-2 opacity-60 cursor-not-allowed"
                      : checked
                      ? "flex items-center gap-3 rounded-xl border border-[var(--color-brand-500)] bg-[var(--color-brand-50)] px-3 py-2 cursor-pointer"
                      : "flex items-center gap-3 rounded-xl border border-[var(--color-ink-200)] bg-white px-3 py-2 hover:border-[var(--color-brand-300)] cursor-pointer"
                  }
                >
                  <Checkbox
                    checked={checked}
                    onCheckedChange={() => {
                      if (safe) return;
                      const set = new Set(accountIds);
                      if (set.has(a.id)) set.delete(a.id);
                      else set.add(a.id);
                      onChange({ accountIds: Array.from(set) });
                    }}
                    label={a.name}
                  />
                  <div className="flex-1 min-w-0">
                    <div className="text-[13px] font-medium text-ink-900 [color:var(--color-ink-900)] truncate">
                      {a.name}
                    </div>
                    <div className="text-[11px] text-ink-500 [color:var(--color-ink-500)] flex items-center gap-2">
                      {a.status === "warming" && (
                        <span className="inline-flex items-center gap-0.5 text-[var(--color-warning-700)]">
                          <Hourglass className="size-3" aria-hidden />
                          ウォームアップ Day {a.warmupDay}/14
                        </span>
                      )}
                      {a.status === "safe_mode" && (
                        <span className="inline-flex items-center gap-0.5 text-[var(--color-danger-700)]">
                          <ShieldAlert className="size-3" aria-hidden />
                          安全モード作動中
                        </span>
                      )}
                      <span className="tabular font-mono">日次上限 {cap} 件</span>
                    </div>
                  </div>
                </label>
              );
            })
          )}
        </div>
      </Field>

      <div className="grid sm:grid-cols-3 gap-3">
        <Field
          label="日次上限"
          hint={`安全側: 選択中アカウントの最小キャップ ${minWarmupCap} 件`}
          error={errors?.dailyLimit}
        >
          <Input
            type="number"
            value={dailyLimit}
            min={1}
            max={200}
            onChange={(e) => onChange({ dailyLimit: Number(e.target.value) || 1 })}
          />
        </Field>
        <Field label="開始時刻">
          <Input
            type="time"
            value={startTime}
            onChange={(e) => onChange({ startTime: e.target.value })}
          />
        </Field>
        <Field label="終了時刻" error={errors?.endTime}>
          <Input
            type="time"
            value={endTime}
            onChange={(e) => onChange({ endTime: e.target.value })}
          />
        </Field>
      </div>

      <label className="inline-flex items-center gap-2 text-[13px] text-ink-700 [color:var(--color-ink-700)] cursor-pointer">
        <Checkbox
          checked={weekdaysOnly}
          onCheckedChange={(v) => onChange({ weekdaysOnly: v })}
          label="平日のみ送信"
        />
        平日のみ送信する
      </label>

      {overWarmup && (
        <div
          role="alert"
          className="rounded-xl border border-[#FDE68A] bg-[var(--color-warning-50)] px-4 py-3 text-[12px] text-[var(--color-warning-700)]"
        >
          日次上限 {dailyLimit} 件が、選択中アカウントの安全上限 {minWarmupCap} 件を超えています。
          ローンチ時に自動で {minWarmupCap} 件まで押し戻されます。
        </div>
      )}

      <Field label="レビューモード" required>
        <div role="radiogroup" aria-label="レビューモード" className="grid sm:grid-cols-2 gap-2">
          {REVIEW_MODES.map((m) => {
            const active = reviewMode === m;
            const meta = REVIEW_MODE_LABEL[m];
            return (
              <label
                key={m}
                className={
                  active
                    ? "flex items-start gap-2.5 rounded-xl border border-[var(--color-brand-500)] bg-[linear-gradient(180deg,rgba(240,249,255,0.6),white)] px-3 py-2.5 cursor-pointer"
                    : "flex items-start gap-2.5 rounded-xl border border-[var(--color-ink-200)] bg-white px-3 py-2.5 hover:border-[var(--color-brand-300)] cursor-pointer"
                }
              >
                <input
                  type="radio"
                  name="reviewMode"
                  value={m}
                  checked={active}
                  onChange={() => onChange({ reviewMode: m })}
                  className="mt-1"
                />
                <div className="text-[12px]">
                  <div className="font-medium text-ink-900 [color:var(--color-ink-900)]">{meta.ja}</div>
                  <div className="text-ink-500 [color:var(--color-ink-500)] mt-0.5">{meta.desc}</div>
                </div>
              </label>
            );
          })}
        </div>
      </Field>

      <Field label="開始日" required error={errors?.startsAt}>
        <Input
          type="date"
          value={startsAt}
          onChange={(e) => onChange({ startsAt: e.target.value })}
          className="max-w-[200px]"
        />
      </Field>

      <label
        className="flex items-start gap-2 cursor-pointer"
        aria-describedby={errors?.consentPolicy ? "consent-error" : undefined}
      >
        <Checkbox
          checked={consent}
          onCheckedChange={(v) => onChange({ consentPolicy: v })}
          label="利用規約に同意"
        />
        <span className="text-[12px] text-ink-700 [color:var(--color-ink-700)] leading-relaxed">
          <a
            href="/legal/usage-policy"
            target="_blank"
            rel="noreferrer"
            className="text-[var(--color-brand-700)] hover:underline"
          >
            利用上の注意
          </a>
          および LinkedIn 利用規約に同意して、本キャンペーンを実行します。
        </span>
      </label>
      {errors?.consentPolicy && (
        <div id="consent-error" role="alert" className="text-[11px] text-[var(--color-danger-700)]">
          {errors.consentPolicy}
        </div>
      )}
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
