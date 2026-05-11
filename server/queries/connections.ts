import "server-only";
import { and, eq, gte, sql } from "drizzle-orm";
import { getDb, schema } from "@/db/client";
import { newIncidentId } from "@/lib/incident";
import { WARMUP_DAILY_CAP_BY_DAY } from "@/lib/wizard-schema";

export type LinkedinAccount = {
  id: string;
  displayName: string;
  unipileAccountId: string;
  status: "active" | "warming" | "safe_mode" | "disconnected";
  warmupDay: number;
  warmupCap: number;
  dailyLimit: number;
  todaySent: number;
  todayReplied: number;
  ownerUserId: string;
  ownerName: string | null;
  createdAt: string;
  // 安全モード関連
  lastWarningAt: string | null;
};

export type ConnectionsResult =
  | { ok: true; accounts: LinkedinAccount[]; source: "live" | "mock" }
  | { ok: false; reason: "degraded"; incidentId: string };

export async function listLinkedinConnections(
  orgId: string | null
): Promise<ConnectionsResult> {
  const db = getDb();
  if (!db || !orgId) {
    return { ok: true, source: "mock", accounts: mockAccounts() };
  }

  try {
    // 「本日」を Asia/Tokyo 00:00 で固定 (UTC ホストでも JST 営業日でカウント)
    const todayStart = (() => {
      const parts = new Intl.DateTimeFormat("ja-JP", {
        timeZone: "Asia/Tokyo",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      }).formatToParts(new Date());
      const y = parts.find((p) => p.type === "year")!.value;
      const m = parts.find((p) => p.type === "month")!.value;
      const d = parts.find((p) => p.type === "day")!.value;
      return new Date(`${y}-${m}-${d}T00:00:00+09:00`);
    })();

    const rows = await db
      .select({
        id: schema.linkedinAccounts.id,
        displayName: schema.linkedinAccounts.displayName,
        unipileAccountId: schema.linkedinAccounts.unipileAccountId,
        status: schema.linkedinAccounts.status,
        warmupDay: schema.linkedinAccounts.warmupDay,
        dailyLimit: schema.linkedinAccounts.dailyLimit,
        ownerUserId: schema.linkedinAccounts.ownerUserId,
        ownerName: schema.users.name,
        createdAt: schema.linkedinAccounts.createdAt,
      })
      .from(schema.linkedinAccounts)
      .leftJoin(schema.users, eq(schema.users.id, schema.linkedinAccounts.ownerUserId))
      .where(eq(schema.linkedinAccounts.orgId, orgId));

    if (rows.length === 0) {
      return { ok: true, source: "live", accounts: [] };
    }

    // 本日送信数 = リードの lastActionAt が本日かつ state in (MESSAGED,REPLIED,MEETING,COMPLETED)
    // assignedAccountId 経由で対応付け
    const accountIds = rows.map((r) => r.id);
    const sentCounts = await db
      .select({
        accountId: schema.leads.assignedAccountId,
        sent: sql<number>`count(*) filter (where ${schema.leads.state} in ('MESSAGED','REPLIED','MEETING','COMPLETED'))::int`,
        replied: sql<number>`count(*) filter (where ${schema.leads.state} in ('REPLIED','MEETING','COMPLETED'))::int`,
      })
      .from(schema.leads)
      .where(
        and(
          eq(schema.leads.orgId, orgId),
          gte(schema.leads.lastActionAt, todayStart),
          sql`${schema.leads.assignedAccountId} = ANY(${accountIds})`
        )
      )
      .groupBy(schema.leads.assignedAccountId);

    const sentMap = new Map<string, { sent: number; replied: number }>();
    for (const c of sentCounts) {
      if (c.accountId) sentMap.set(c.accountId, { sent: Number(c.sent), replied: Number(c.replied) });
    }

    const accounts: LinkedinAccount[] = rows.map((r) => {
      const status = normalizeStatus(r.status, r.warmupDay);
      return {
        id: r.id,
        displayName: r.displayName,
        unipileAccountId: r.unipileAccountId,
        status,
        warmupDay: r.warmupDay,
        warmupCap: WARMUP_DAILY_CAP_BY_DAY(r.warmupDay),
        dailyLimit: r.dailyLimit,
        todaySent: sentMap.get(r.id)?.sent ?? 0,
        todayReplied: sentMap.get(r.id)?.replied ?? 0,
        ownerUserId: r.ownerUserId,
        ownerName: r.ownerName ?? null,
        createdAt: r.createdAt.toISOString(),
        lastWarningAt: null,
      };
    });

    return { ok: true, source: "live", accounts };
  } catch (e) {
    const incidentId = newIncidentId();
    if (process.env.NODE_ENV !== "production") {
      console.error(`[listLinkedinConnections] ${incidentId}`, e);
    }
    return { ok: false, reason: "degraded", incidentId };
  }
}

function normalizeStatus(
  raw: string,
  warmupDay: number
): LinkedinAccount["status"] {
  if (raw === "safe_mode") return "safe_mode";
  if (raw === "disconnected") return "disconnected";
  if (warmupDay < 14) return "warming";
  return "active";
}

/* ---------------- Mock ---------------- */

function mockAccounts(): LinkedinAccount[] {
  return [
    mk(
      "00000000-0000-4000-8000-000000000001",
      "林 翔太",
      "unipile_hayashi",
      "active",
      14,
      25,
      18,
      4,
      "user-hayashi",
      "林 翔太"
    ),
    mk(
      "00000000-0000-4000-8000-000000000002",
      "佐藤 美咲",
      "unipile_sato",
      "warming",
      7,
      25,
      7,
      1,
      "user-sato",
      "佐藤 美咲"
    ),
    mk(
      "00000000-0000-4000-8000-000000000003",
      "鈴木 大輔",
      "unipile_suzuki",
      "safe_mode",
      14,
      25,
      0,
      0,
      "user-suzuki",
      "鈴木 大輔",
      6
    ),
  ];
}

function mk(
  id: string,
  displayName: string,
  unipileAccountId: string,
  status: LinkedinAccount["status"],
  warmupDay: number,
  dailyLimit: number,
  todaySent: number,
  todayReplied: number,
  ownerUserId: string,
  ownerName: string,
  warningHoursAgo?: number
): LinkedinAccount {
  return {
    id,
    displayName,
    unipileAccountId,
    status: status === "active" && warmupDay < 14 ? "warming" : status,
    warmupDay,
    warmupCap: WARMUP_DAILY_CAP_BY_DAY(warmupDay),
    dailyLimit,
    todaySent,
    todayReplied,
    ownerUserId,
    ownerName,
    createdAt: new Date(Date.now() - 30 * 86400_000).toISOString(),
    lastWarningAt: warningHoursAgo
      ? new Date(Date.now() - warningHoursAgo * 3600_000).toISOString()
      : null,
  };
}
