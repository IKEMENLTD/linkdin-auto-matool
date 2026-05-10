import { formatDistanceToNowStrict } from "date-fns";
import { ja } from "date-fns/locale";

const numberJP = new Intl.NumberFormat("ja-JP");
const percentJP = new Intl.NumberFormat("ja-JP", {
  style: "percent",
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
});
const currencyJP = new Intl.NumberFormat("ja-JP", {
  style: "currency",
  currency: "JPY",
  maximumFractionDigits: 0,
});

export const fmtNumber = (n: number) => numberJP.format(n);
export const fmtPercent = (n: number) => percentJP.format(n);
export const fmtCurrency = (n: number) => currencyJP.format(n);

export const fmtCompact = (n: number) => {
  if (n >= 1_0000_0000) return `${(n / 1_0000_0000).toFixed(1)}億`;
  if (n >= 1_0000) return `${(n / 1_0000).toFixed(1)}万`;
  return numberJP.format(n);
};

export const fmtRelative = (date: Date | string | number) => {
  const d = typeof date === "string" || typeof date === "number" ? new Date(date) : date;
  return formatDistanceToNowStrict(d, { locale: ja, addSuffix: true });
};

export const fmtDelta = (current: number, previous: number) => {
  if (previous === 0) return { value: 0, sign: "flat" as const, percent: 0 };
  const diff = current - previous;
  const percent = (diff / previous) * 100;
  return {
    value: diff,
    sign: diff > 0 ? ("up" as const) : diff < 0 ? ("down" as const) : ("flat" as const),
    percent: Math.abs(percent),
  };
};
