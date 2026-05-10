import Link from "next/link";
import { ArrowUpRight, ArrowDownRight, Minus } from "lucide-react";
import { Card, CardBody } from "@/components/ui/card";
import { fmtCompact, fmtNumber } from "@/lib/formatters";
import { cn } from "@/lib/utils";

interface Props {
  label: string;
  current: number;
  previous: number;
  unit?: "count" | "percent" | "currency";
  hint?: string;
  spark?: number[];
  href?: string;
}

const Sparkline = ({ values, gradId }: { values: number[]; gradId: string }) => {
  if (!values.length) return null;
  const max = Math.max(...values, 1);
  const min = Math.min(...values, 0);
  const range = max - min || 1;
  const w = 96;
  const h = 28;
  const stepX = w / Math.max(values.length - 1, 1);
  const points = values.map((v, i) => `${i * stepX},${h - ((v - min) / range) * h}`);
  return (
    <svg
      width={w}
      height={h}
      viewBox={`0 0 ${w} ${h}`}
      aria-hidden
      className="text-[var(--color-brand-500)]"
    >
      <defs>
        <linearGradient id={gradId} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0" stopColor="#0EA5E9" stopOpacity="0.32" />
          <stop offset="1" stopColor="#0EA5E9" stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={`M0,${h} L${points.join(" L ")} L${w},${h} Z`} fill={`url(#${gradId})`} />
      <path d={`M${points.join(" L ")}`} fill="none" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  );
};

export function KpiCard({ label, current, previous, unit = "count", hint, spark, href }: Props) {
  // 比率系は pp（パーセントポイント）差分、数値系は %差分
  const isPercent = unit === "percent";
  const absDiff = current - previous;
  const ppDelta = isPercent ? (current - previous) * 100 : null;
  const pctDelta = !isPercent && previous !== 0 ? (absDiff / previous) * 100 : null;

  const sign = absDiff > 0 ? "up" : absDiff < 0 ? "down" : "flat";
  const Arrow = sign === "up" ? ArrowUpRight : sign === "down" ? ArrowDownRight : Minus;
  const deltaColor =
    sign === "up"
      ? "text-[var(--color-success-700)]"
      : sign === "down"
      ? "text-[var(--color-danger-700)]"
      : "text-ink-500 [color:var(--color-ink-500)]";

  const display =
    unit === "percent"
      ? `${(current * 100).toFixed(1)}%`
      : unit === "currency"
      ? `¥${fmtCompact(current)}`
      : fmtCompact(current);

  const deltaText = isPercent
    ? ppDelta === null
      ? "—"
      : `${ppDelta > 0 ? "+" : ""}${ppDelta.toFixed(1)} pp`
    : pctDelta === null
    ? previous === 0 && current === 0
      ? "0%"
      : "新規"
    : `${pctDelta > 0 ? "+" : ""}${pctDelta.toFixed(1)}%`;

  const absDelta =
    isPercent || pctDelta === null
      ? null
      : ` · ${absDiff > 0 ? "+" : ""}${fmtNumber(absDiff)}`;

  const sparkId = `spk-${label.replace(/\s+/g, "-")}`;

  const inner = (
    <Card className="overflow-hidden hover:shadow-[var(--shadow-elevated)] transition-shadow">
      <CardBody className="p-5">
        <div className="flex items-start justify-between gap-2">
          <div className="text-[11px] font-medium tracking-[0.16em] uppercase text-ink-500 [color:var(--color-ink-500)]">
            {label}
          </div>
          {spark && spark.length > 0 && <Sparkline values={spark} gradId={sparkId} />}
        </div>
        <div className="mt-3 flex items-baseline gap-2">
          <div className="kpi-numeral text-[44px]">{display}</div>
        </div>
        <div className="mt-2 flex items-center justify-between gap-2 text-[12px]">
          <span
            className={cn(
              "inline-flex items-center gap-1 font-medium tabular font-mono",
              deltaColor
            )}
          >
            <Arrow className="size-3.5" aria-hidden />
            {deltaText}
            {absDelta && (
              <span className="text-ink-400 [color:var(--color-ink-400)]">{absDelta}</span>
            )}
          </span>
          {hint && (
            <span className="text-ink-400 [color:var(--color-ink-400)] truncate">{hint}</span>
          )}
        </div>
      </CardBody>
    </Card>
  );

  if (href) {
    return (
      <Link
        href={href}
        className="block rounded-[var(--radius-lg)] hover:translate-y-[-2px] transition group"
      >
        {inner}
      </Link>
    );
  }
  return <div className="block">{inner}</div>;
}
