import "server-only";

import { z } from "zod";
import { and, eq, gte, sql } from "drizzle-orm";

import { schema } from "@/db/client";
import { getWarmupLimit } from "./warmup-curve";

/**
 * Daily Limit Guard (BAN リスク低減 / 7層防御の Layer 5)。
 *
 * 仕組み:
 *  1. linkedin_accounts から (warmupDay, dailyLimit, status) を取得
 *  2. warmup curve で本日の上限件数 L を計算
 *  3. messages JOIN leads で、当該アカウントに紐づく lead からの
 *     direction='outbound' AND sentAt >= 今日 0 時 (JST) を COUNT
 *  4. sent < L なら ok, それ以外は reason='limit_exceeded'
 *
 * タイムゾーン設計判断:
 *  - Postgres `AT TIME ZONE` を WHERE 句の関数として使うと index 非効率
 *  - TS 側で「今日の 0 時 JST」を Date に変換し、`sent_at >= $1` で単純比較
 *  - 既存の `msg_sent_idx` をそのまま使える
 *  - Asia/Tokyo の DST 無しに依存した最適化 (IANA tzdata 安定前提)
 */

const Input = z.object({
  accountId: z.string().uuid(),
});

export type DailyLimitOk = {
  ok: true;
  sent: number;
  limit: number;
};
export type DailyLimitNg = {
  ok: false;
  reason: "limit_exceeded" | "account_not_found" | "account_inactive";
  sent: number;
  limit: number;
};
export type DailyLimitResult = DailyLimitOk | DailyLimitNg;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyDrizzle = { select: any };

/**
 * 「今日の 0 時 JST」に相当する UTC Date を返す。
 *
 * 例 (実行時刻 2026-05-12 10:00 JST = 2026-05-12 01:00 UTC):
 *   返却値 = 2026-05-11 15:00 UTC (= 2026-05-12 00:00 JST)
 */
export function getJstMidnightUtc(now: Date = new Date()): Date {
  const JST_OFFSET_MS = 9 * 60 * 60 * 1000;
  const jstMs = now.getTime() + JST_OFFSET_MS;
  const jstDayStartMs = Math.floor(jstMs / 86_400_000) * 86_400_000;
  return new Date(jstDayStartMs - JST_OFFSET_MS);
}

/**
 * Daily limit を検査する。Drizzle トランザクション (`tx`) でも、
 * 通常の db クライアントでも呼べる。
 */
export async function checkDailyLimit(
  accountId: string,
  tx: AnyDrizzle,
  now: Date = new Date()
): Promise<DailyLimitResult> {
  const parsed = Input.safeParse({ accountId });
  if (!parsed.success) {
    return { ok: false, reason: "account_not_found", sent: 0, limit: 0 };
  }

  const accountRows = await tx
    .select({
      id: schema.linkedinAccounts.id,
      warmupDay: schema.linkedinAccounts.warmupDay,
      dailyLimit: schema.linkedinAccounts.dailyLimit,
      status: schema.linkedinAccounts.status,
    })
    .from(schema.linkedinAccounts)
    .where(eq(schema.linkedinAccounts.id, parsed.data.accountId))
    .limit(1);

  const account = accountRows[0] as
    | { id: string; warmupDay: number; dailyLimit: number; status: string }
    | undefined;

  if (!account) {
    return { ok: false, reason: "account_not_found", sent: 0, limit: 0 };
  }
  if (account.status !== "active") {
    return { ok: false, reason: "account_inactive", sent: 0, limit: 0 };
  }

  const limit = getWarmupLimit(account.warmupDay, account.dailyLimit);
  const jstMidnightUtc = getJstMidnightUtc(now);

  const countRows = await tx
    .select({ c: sql<number>`count(*)::int` })
    .from(schema.messages)
    .innerJoin(schema.leads, eq(schema.leads.id, schema.messages.leadId))
    .where(
      and(
        eq(schema.leads.assignedAccountId, account.id),
        eq(schema.messages.direction, "outbound"),
        gte(schema.messages.sentAt, jstMidnightUtc)
      )
    );

  const sent = Number(countRows[0]?.c ?? 0);

  if (sent >= limit) {
    return { ok: false, reason: "limit_exceeded", sent, limit };
  }
  return { ok: true, sent, limit };
}
