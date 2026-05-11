import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * Postgres `LIKE` / `ILIKE` のメタ文字 (`%` `_` `\`) をエスケープ。
 * パラメータ化で SQLi は防げるが、ユーザ入力の `%` は全件マッチに化けるため必須。
 */
export function escapeLikePattern(input: string): string {
  return input.replace(/\\/g, "\\\\").replace(/%/g, "\\%").replace(/_/g, "\\_");
}

/** 数値をクランプ */
export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/**
 * 外部リンク用 URL の安全化。
 * `javascript:` / `data:` / `file:` 等の危険スキームを拒否し、許可された scheme のみ通す。
 * 不正な値は null を返す → UI 側で表示を抑制すること。
 */
export function safeExternalUrl(input: string | null | undefined): string | null {
  if (!input) return null;
  const trimmed = input.trim();
  try {
    const u = new URL(trimmed);
    if (u.protocol === "http:" || u.protocol === "https:") return u.toString();
    return null;
  } catch {
    return null;
  }
}
