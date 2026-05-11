"use client";

import * as React from "react";
import { Wand2, Eye, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  TONES,
  TONE_META,
  LENGTHS,
  type Step4,
  type Tone,
  type Length,
} from "@/lib/wizard-schema";

interface Props {
  value: Partial<Step4>;
  companyName?: string;
  onChange: (next: Partial<Step4>) => void;
  errors?: Record<string, string>;
}

const LENGTH_LABEL: Record<Length, string> = {
  short: "短め",
  medium: "標準",
  long: "長め",
};

function aiDraft(companyName: string | undefined, tone: Tone, length: Length, variant: "a" | "b" | "connect"): string {
  const greeting = tone === "formal" ? "突然のご連絡失礼いたします。" : "突然のご連絡、失礼いたします。";
  const closing =
    tone === "formal"
      ? "もしご興味があれば、15 分ほどお時間いただけますと幸いです。"
      : "もしご興味があれば、ぜひ一度お話しできますと嬉しいです。";
  const co = companyName ?? "御社";
  const lengths = {
    short: 1,
    medium: 2,
    long: 3,
  } as const;

  if (variant === "connect") {
    return `${greeting}${co}様の事業を拝見し、ぜひコネクトさせていただきたくご連絡しました。`;
  }

  const bodies =
    variant === "a"
      ? [
          `${co}様の最近の取り組みを拝見し、AI 駆動の SDR 支援が組み合わせやすそうだと感じました。`,
          `現在、{{業界}} のお客様で、初回返信率が平均比 +12pt の事例が出ています。`,
          `また、日本語の自然なメッセージ生成に注力しており、海外ツールと差別化できる点が好評です。`,
        ]
      : [
          `${co}様の事業の伸びを拝見し、メッセージを差し上げました。`,
          `当社の AI は、貴社の事例や FAQ を学習した上で、一通ずつ「人が書いた下書き」を生成します。`,
          `導入企業様の 80% が、SDR 1 名分の活動量を生み出しています。`,
        ];

  return [...bodies.slice(0, lengths[length]), closing].join("\n\n");
}

export function StepMessage({ value, companyName, onChange, errors }: Props) {
  const tone = value.tone ?? "formal";
  const length = value.length ?? "medium";
  const connect = value.connectMessage ?? "";
  const firstDm = value.firstDm ?? "";
  const abEnabled = value.abEnabled ?? false;
  const variantB = value.abVariantB ?? "";

  const generate = (key: "connect" | "firstDm" | "variantB") => {
    if (key === "connect") onChange({ connectMessage: aiDraft(companyName, tone, "short", "connect") });
    if (key === "firstDm") onChange({ firstDm: aiDraft(companyName, tone, length, "a") });
    if (key === "variantB") onChange({ abVariantB: aiDraft(companyName, tone, length, "b") });
  };

  const hasUnfilled = /\{\{\s*[a-zA-Z_]+\s*\}\}/.test(firstDm);

  return (
    <div className="space-y-5">
      <div className="grid sm:grid-cols-2 gap-3">
        <Field label="トーン">
          <div className="flex gap-1.5 flex-wrap">
            {TONES.map((t) => (
              <button
                key={t}
                type="button"
                aria-pressed={tone === t}
                onClick={() => onChange({ tone: t })}
                className={
                  tone === t
                    ? "rounded-full px-3 py-1 text-[12px] border border-[var(--color-brand-500)] bg-[var(--color-brand-50)] text-[var(--color-brand-700)] font-medium"
                    : "rounded-full px-3 py-1 text-[12px] border border-[var(--color-ink-200)] bg-white text-ink-700 [color:var(--color-ink-700)] hover:border-[var(--color-brand-300)]"
                }
              >
                {TONE_META[t].ja}
              </button>
            ))}
          </div>
        </Field>
        <Field label="長さ">
          <div className="flex gap-1.5">
            {LENGTHS.map((l) => (
              <button
                key={l}
                type="button"
                aria-pressed={length === l}
                onClick={() => onChange({ length: l })}
                className={
                  length === l
                    ? "rounded-full px-3 py-1 text-[12px] border border-[var(--color-brand-500)] bg-[var(--color-brand-50)] text-[var(--color-brand-700)] font-medium"
                    : "rounded-full px-3 py-1 text-[12px] border border-[var(--color-ink-200)] bg-white text-ink-700 [color:var(--color-ink-700)] hover:border-[var(--color-brand-300)]"
                }
              >
                {LENGTH_LABEL[l]}
              </button>
            ))}
          </div>
        </Field>
      </div>

      <Field
        label="コネクト申請メッセージ"
        hint="LinkedIn 仕様により 300 文字以内 / テンプレ変数は不可"
        error={errors?.connectMessage}
        counter={`${connect.length} / 300`}
      >
        <textarea
          value={connect}
          onChange={(e) => onChange({ connectMessage: e.target.value })}
          rows={3}
          maxLength={300}
          className="block w-full px-3 py-2 rounded-xl border border-[var(--color-ink-200)] bg-white text-[14px] text-ink-900 placeholder:text-ink-400 focus:border-[var(--color-brand-500)] transition resize-none"
          placeholder="◯◯様、突然のご連絡失礼いたします。"
        />
        <div className="mt-2 flex justify-between items-center">
          <button
            type="button"
            onClick={() => generate("connect")}
            className="inline-flex items-center gap-1.5 text-[12px] text-[var(--color-brand-700)] hover:text-[var(--color-brand-900)]"
          >
            <Wand2 className="size-3.5" aria-hidden />
            AI に下書きさせる
          </button>
        </div>
      </Field>

      <Field
        label="初回 DM (承認後の1通目)"
        required
        error={errors?.firstDm}
        counter={`${firstDm.length} / 1500`}
      >
        <textarea
          value={firstDm}
          onChange={(e) => onChange({ firstDm: e.target.value })}
          rows={8}
          maxLength={1500}
          className="block w-full px-3 py-2 rounded-xl border border-[var(--color-ink-200)] bg-white text-[14px] text-ink-900 placeholder:text-ink-400 focus:border-[var(--color-brand-500)] transition resize-none font-[var(--font-sans)]"
          placeholder="ご返信ありがとうございます。少しご質問をさせていただいてもよろしいでしょうか…"
        />
        <div className="mt-2 flex justify-between items-center">
          <button
            type="button"
            onClick={() => generate("firstDm")}
            className="inline-flex items-center gap-1.5 text-[12px] text-[var(--color-brand-700)] hover:text-[var(--color-brand-900)]"
          >
            <Wand2 className="size-3.5" aria-hidden />
            AI に案 A を生成させる
          </button>
          <button
            type="button"
            disabled
            title="Phase2 で実装予定"
            className="inline-flex items-center gap-1.5 text-[12px] text-ink-400 [color:var(--color-ink-400)] cursor-not-allowed"
          >
            <Eye className="size-3.5" aria-hidden />
            根拠を見る (Phase2)
          </button>
        </div>
        {hasUnfilled && (
          <div role="alert" className="mt-2 text-[11px] flex items-start gap-1 text-[var(--color-warning-700)]">
            <AlertTriangle className="size-3 mt-0.5" aria-hidden />
            テンプレート変数 (例: {"{{name}}"}) が残っています。差し込み変数を実装するか削除してください。
          </div>
        )}
      </Field>

      <div className="rounded-2xl border border-[var(--color-ink-200)] bg-white p-4 space-y-3">
        <label className="flex items-center gap-2 cursor-pointer">
          <Checkbox
            checked={abEnabled}
            onCheckedChange={(v) => onChange({ abEnabled: v })}
            label="A/B テスト"
          />
          <span className="text-[13px] font-medium text-ink-900 [color:var(--color-ink-900)]">
            A/B テストを有効化 (配信比率 50/50)
          </span>
        </label>
        {abEnabled && (
          <Field
            label="案 B"
            required
            error={errors?.abVariantB}
            counter={`${variantB.length} / 1500`}
          >
            <textarea
              value={variantB}
              onChange={(e) => onChange({ abVariantB: e.target.value })}
              rows={6}
              maxLength={1500}
              className="block w-full px-3 py-2 rounded-xl border border-[var(--color-ink-200)] bg-white text-[14px] text-ink-900 placeholder:text-ink-400 focus:border-[var(--color-brand-500)] transition resize-none"
              placeholder="案 B の文面を記入してください"
            />
            <button
              type="button"
              onClick={() => generate("variantB")}
              className="mt-2 inline-flex items-center gap-1.5 text-[12px] text-[var(--color-brand-700)] hover:text-[var(--color-brand-900)]"
            >
              <Wand2 className="size-3.5" aria-hidden />
              AI に案 B を生成させる
            </button>
          </Field>
        )}
      </div>
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
    <div className="block">
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
    </div>
  );
}
