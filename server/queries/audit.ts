import "server-only";
import { and, desc, eq, sql } from "drizzle-orm";
import { getDb, schema } from "@/db/client";
import { newIncidentId } from "@/lib/incident";
import { clamp } from "@/lib/utils";

export type AuditEntry = {
  id: string;
  actorName: string | null;
  actorEmail: string | null;
  action: string;
  targetType: string | null;
  targetId: string | null;
  purpose: string | null;
  diff: Record<string, unknown> | null;
  fromIp: string | null;
  correlationId: string | null;
  prevHash: string | null;
  hash: string;
  createdAt: string;
};

export type AuditResult =
  | {
      ok: true;
      entries: AuditEntry[];
      total: number;
      source: "live" | "mock";
      /** Phase2 で daily verification job 実装後に ISO 文字列が入る。null = 未検証 */
      verifiedAt: string | null;
    }
  | { ok: false; reason: "degraded"; incidentId: string };

export async function listAuditLog(
  orgId: string | null,
  page = 1,
  perPage = 50
): Promise<AuditResult> {
  const safePage = clamp(Math.floor(Number(page) || 1), 1, 1000);
  const safePerPage = clamp(Math.floor(Number(perPage) || 50), 10, 200);
  const db = getDb();
  if (!db || !orgId) {
    return {
      ok: true,
      entries: mockAudit(),
      total: mockAudit().length,
      source: "mock",
      verifiedAt: null,
    };
  }

  try {
    const [rows, totalRow] = await Promise.all([
      db
        .select({
          id: schema.auditLog.id,
          actorName: schema.users.name,
          actorEmail: schema.users.email,
          action: schema.auditLog.action,
          targetType: schema.auditLog.targetType,
          targetId: schema.auditLog.targetId,
          purpose: schema.auditLog.purpose,
          diff: schema.auditLog.diff,
          fromIp: schema.auditLog.fromIp,
          correlationId: schema.auditLog.correlationId,
          prevHash: schema.auditLog.prevHash,
          hash: schema.auditLog.hash,
          createdAt: schema.auditLog.createdAt,
        })
        .from(schema.auditLog)
        .leftJoin(schema.users, eq(schema.users.id, schema.auditLog.actorUserId))
        .where(eq(schema.auditLog.orgId, orgId))
        .orderBy(desc(schema.auditLog.createdAt))
        .limit(safePerPage)
        .offset((safePage - 1) * safePerPage),
      db
        .select({ value: sql<number>`count(*)::int` })
        .from(schema.auditLog)
        .where(eq(schema.auditLog.orgId, orgId)),
    ]);

    return {
      ok: true,
      source: "live",
      verifiedAt: null, // 実検証は Phase2 (root hash の二重保管照合)
      total: Number(totalRow[0]?.value ?? 0),
      entries: rows.map((r) => ({
        id: r.id,
        actorName: r.actorName ?? null,
        actorEmail: r.actorEmail ?? null,
        action: r.action,
        targetType: r.targetType ?? null,
        targetId: r.targetId ?? null,
        purpose: r.purpose ?? null,
        diff: (r.diff as Record<string, unknown> | null) ?? null,
        fromIp: r.fromIp ?? null,
        correlationId: r.correlationId ?? null,
        prevHash: r.prevHash ?? null,
        hash: r.hash,
        createdAt: r.createdAt.toISOString(),
      })),
    };
  } catch (e) {
    const incidentId = newIncidentId();
    if (process.env.NODE_ENV !== "production") console.error(`[listAuditLog] ${incidentId}`, e);
    return { ok: false, reason: "degraded", incidentId };
  }
}

function mockAudit(): AuditEntry[] {
  const now = Date.now();
  return [
    mk("a1", "林 翔太", "hayashi@ikemen.example", "campaign.launched", "campaign", "c1", null, { dailyLimit: 25, accounts: 2 }, 10),
    mk("a2", "佐藤 美咲", "sato@ikemen.example", "message.sent", "lead", "l1", null, { length: 142, aiAssisted: true }, 14),
    mk("a3", "鈴木 大輔", "suzuki@ikemen.example", "campaign.paused", "campaign", "c6", "停滞のため一時停止", { status: { from: "running", to: "paused" } }, 26),
    mk("a4", "田中 健司", "tanaka@ikemen.example", "linkedin.account_paused", "linkedin_account", "00000000-0000-4000-8000-000000000003", "失敗連続 5 回", { status: { to: "safe_mode" } }, 48),
    mk("a5", "林 翔太", "hayashi@ikemen.example", "auth.signin_success", "user", "u2", null, null, 72),
    mk("a6", "佐藤 美咲", "sato@ikemen.example", "lead.bulk_disqualified", "lead", "bulk:8", null, { state: { to: "DISQUALIFIED" }, requested_count: 8 }, 100),
  ];
}

function mk(
  id: string,
  actorName: string,
  email: string,
  action: string,
  targetType: string,
  targetId: string,
  purpose: string | null,
  diff: Record<string, unknown> | null,
  hoursAgo: number
): AuditEntry {
  const hash = `mock${id}${"0".repeat(60)}`.slice(0, 64);
  const prev = id === "a6" ? null : `mock${(parseInt(id.slice(1)) + 1).toString()}${"0".repeat(60)}`.slice(0, 64);
  return {
    id,
    actorName,
    actorEmail: email,
    action,
    targetType,
    targetId,
    purpose,
    diff,
    fromIp: "192.168.1.42",
    correlationId: `${id}-corr-${"0".repeat(20)}`.slice(0, 36),
    prevHash: prev,
    hash,
    createdAt: new Date(Date.now() - hoursAgo * 3600_000).toISOString(),
  };
}
