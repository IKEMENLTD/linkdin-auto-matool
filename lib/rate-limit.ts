import "server-only";

/**
 * 軽量メモリレート制限。
 *
 * **重要**: この実装は **単一 Node プロセス** でしか有効ではない。
 * - Vercel / Cloudflare などサーバレス / 多インスタンス環境では効果が薄い。
 * - 本番では `@upstash/ratelimit` + Redis に置き換える (TODO: Phase2)。
 * - 現状は MVP / 開発時のブルートフォース基本ガードとして使う。
 *
 * key: 任意の識別子 (IP+action 等) / window: ms / limit: 件数
 */
const buckets = new Map<string, { count: number; resetAt: number }>();

export function rateLimit(key: string, limit: number, windowMs: number) {
  const now = Date.now();
  const cur = buckets.get(key);
  if (!cur || now > cur.resetAt) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return { ok: true, remaining: limit - 1, resetAt: now + windowMs };
  }
  if (cur.count >= limit) {
    return { ok: false, remaining: 0, resetAt: cur.resetAt };
  }
  cur.count += 1;
  return { ok: true, remaining: limit - cur.count, resetAt: cur.resetAt };
}

/** 開発時にバケットをクリア (テスト用) */
export function _resetRateLimit() {
  buckets.clear();
}
