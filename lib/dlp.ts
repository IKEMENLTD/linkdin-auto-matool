/**
 * 送信前の機微情報・規約注意ワード DLP 検査。
 * UI (Composer) と Server (sendMessage) で共有し drift を防ぐ。
 *
 * NFKC 正規化 + lower でユーザの全角・互換文字をホワイトリスト化。
 */
const PATTERNS: { regex: RegExp; reason: string }[] = [
  { regex: /(?:\d{2,4}[-\s]?){2,}\d{3,4}/, reason: "電話番号" },
  { regex: /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i, reason: "メールアドレス" },
  { regex: /(?:割引|値引き|特別価格|無料\s*提供|discount|free\s+offer)/i, reason: "価格 / 値引きに関する文言" },
  { regex: /(?:〒?\s?\d{3}-?\d{4})/, reason: "郵便番号" },
];

export function detectDlpViolation(input: string): { reason: string } | null {
  const normalized = (input ?? "").normalize("NFKC");
  for (const p of PATTERNS) {
    if (p.regex.test(normalized)) return { reason: p.reason };
  }
  return null;
}
