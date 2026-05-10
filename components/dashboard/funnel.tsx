"use client";

import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/card";
import { fmtNumber } from "@/lib/formatters";
import { Info } from "lucide-react";

export type FunnelStep = {
  state: string;
  label: string;
  count: number;
};

interface Props {
  steps: FunnelStep[];
}

export function Funnel({ steps }: Props) {
  const max = Math.max(...steps.map((s) => s.count), 1);

  return (
    <Card>
      <CardHeader>
        <div>
          <CardTitle>変換ファネル</CardTitle>
          <div className="text-[11px] text-ink-500 [color:var(--color-ink-500)] mt-0.5">
            状態遷移ごとの絶対数 と 前段からの転換率
          </div>
        </div>
        <button
          type="button"
          aria-label="計算式を見る"
          className="inline-flex items-center gap-1 text-[12px] text-ink-500 [color:var(--color-ink-500)] hover:text-ink-900 [&:hover]:[color:var(--color-ink-900)]"
        >
          <Info className="size-3.5" aria-hidden />
          計算式
        </button>
      </CardHeader>
      <CardBody>
        <ol className="space-y-2.5">
          {steps.map((step, i) => {
            const widthPct = (step.count / max) * 100;
            const prev = i > 0 ? steps[i - 1].count : null;
            const cvr = prev && prev > 0 ? (step.count / prev) * 100 : null;

            return (
              <li key={step.state} className="flex items-center gap-3">
                <div className="w-24 text-[12px] text-ink-700 [color:var(--color-ink-700)] truncate font-medium">
                  {step.label}
                </div>
                <div className="flex-1 relative">
                  <div
                    className="liquid-bar"
                    style={{
                      width: `${Math.max(widthPct, 8)}%`,
                      filter: i === 0 ? "saturate(0.85)" : undefined,
                    }}
                    role="progressbar"
                    aria-valuenow={step.count}
                    aria-valuemin={0}
                    aria-valuemax={max}
                  >
                    <div className="absolute inset-0 flex items-center justify-end pr-3 text-white font-mono tabular text-[13px] font-semibold drop-shadow-sm">
                      {fmtNumber(step.count)}
                    </div>
                  </div>
                </div>
                <div className="w-16 text-right text-[12px] tabular font-mono text-ink-500 [color:var(--color-ink-500)]">
                  {cvr !== null ? `${cvr.toFixed(1)}%` : "—"}
                </div>
              </li>
            );
          })}
        </ol>
      </CardBody>
    </Card>
  );
}
