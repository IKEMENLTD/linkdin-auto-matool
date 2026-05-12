import "server-only";

/**
 * Warmup curve: アカウント年齢別に 1 日あたりの送信上限割合を返す。
 *
 * LinkedIn は新規 / 復帰アカウントに対して急激な送信スパイクを
 * BAN シグナルとして扱うため、warmupDay (0..14) を見て段階的に上限を緩める。
 *
 * 数値はテスト容易性のため named constant として export する。
 */

/** Day 0 (初日): baseDailyLimit の 20% — 最初の一歩は最小限 */
export const WARMUP_RATIO_DAY_0 = 0.2;

/** Day 1-3: 30% — まだ「新規」枠 */
export const WARMUP_RATIO_DAY_1_3 = 0.3;

/** Day 4-7: 60% — 慣らし期間中盤 */
export const WARMUP_RATIO_DAY_4_7 = 0.6;

/** Day 8-13: 80% — ほぼ通常稼働。最終調整 */
export const WARMUP_RATIO_DAY_8_13 = 0.8;

/** Day 14+: 100% — 完全稼働 */
export const WARMUP_RATIO_DAY_14_PLUS = 1.0;

/** warmupDay の許容上限 (これ以上は 14+ と同じ扱い) */
export const WARMUP_DAY_MAX = 14;

/**
 * warmupDay と baseDailyLimit から「今日の送信上限 (件数)」を返す。
 *
 * 仕様:
 * - Day 0     -> 20%
 * - Day 1-3   -> 30%
 * - Day 4-7   -> 60%
 * - Day 8-13  -> 80%
 * - Day 14+   -> 100%
 *
 * Edge case:
 * - warmupDay が負数 / NaN / 非有限 -> Day 0 扱い (最も保守的)
 * - warmupDay が WARMUP_DAY_MAX を超える -> 100% 扱い
 * - baseDailyLimit が 0 以下 / NaN / 非有限 -> 0 (送信不可)
 *
 * 戻り値は Math.floor で切り捨て (例: 25 * 0.3 = 7.5 -> 7)。
 */
export function getWarmupLimit(warmupDay: number, baseDailyLimit: number): number {
  if (
    typeof baseDailyLimit !== "number" ||
    !Number.isFinite(baseDailyLimit) ||
    baseDailyLimit <= 0
  ) {
    return 0;
  }

  const day =
    typeof warmupDay !== "number" || !Number.isFinite(warmupDay) || warmupDay < 0
      ? 0
      : Math.floor(warmupDay);

  const ratio = getWarmupRatio(day);
  return Math.floor(baseDailyLimit * ratio);
}

/**
 * 内部用: day -> ratio のマッピング。
 */
export function getWarmupRatio(day: number): number {
  if (day <= 0) return WARMUP_RATIO_DAY_0;
  if (day <= 3) return WARMUP_RATIO_DAY_1_3;
  if (day <= 7) return WARMUP_RATIO_DAY_4_7;
  if (day <= 13) return WARMUP_RATIO_DAY_8_13;
  return WARMUP_RATIO_DAY_14_PLUS;
}
