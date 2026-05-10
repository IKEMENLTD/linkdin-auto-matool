import "server-only";
import { createHash } from "node:crypto";
import { desc, eq } from "drizzle-orm";
import { getDb, schema } from "@/db/client";

export type AuditAction =
  | "auth.signin_requested"
  | "auth.signin_failed"
  | "auth.signin_success"
  | "auth.signout"
  | "campaign.created"
  | "campaign.launched"
  | "message.sent"
  | "linkedin.account_connected"
  | "linkedin.account_disconnected"
  | "csv.export"
  | "data.delete_requested"
  | "BREAK_GLASS"
  | "CIRCUIT_BREAKER";

interface WriteAuditInput {
  orgId: string;
  actorUserId?: string | null;
  action: AuditAction;
  targetType?: string;
  targetId?: string;
  purpose?: string;
  diff?: Record<string, unknown>;
  fromIp?: string;
  fromUa?: string;
  correlationId?: string;
}

/**
 * 監査ログ append-only 書込み (UI/UX 設計書 §17 改竄耐性)。
 * - 直前エントリの hash を読み出し、prev_hash として記録
 * - 自身の hash = SHA-256(prev_hash || normalized JSON)
 * - DB 未接続時は no-op (MVP デモ運用)
 */
export async function writeAudit(input: WriteAuditInput): Promise<{ id: string; hash: string } | null> {
  const db = getDb();
  if (!db) return null;

  const [previous] = await db
    .select({ hash: schema.auditLog.hash })
    .from(schema.auditLog)
    .where(eq(schema.auditLog.orgId, input.orgId))
    .orderBy(desc(schema.auditLog.createdAt))
    .limit(1);

  const prevHash = previous?.hash ?? "";
  const normalized = JSON.stringify({
    orgId: input.orgId,
    actorUserId: input.actorUserId ?? null,
    action: input.action,
    targetType: input.targetType ?? null,
    targetId: input.targetId ?? null,
    purpose: input.purpose ?? null,
    diff: input.diff ?? null,
    fromIp: input.fromIp ?? null,
    fromUa: input.fromUa ?? null,
    correlationId: input.correlationId ?? null,
  });
  const hash = createHash("sha256").update(prevHash + normalized).digest("hex");

  const [row] = await db
    .insert(schema.auditLog)
    .values({
      orgId: input.orgId,
      actorUserId: input.actorUserId ?? null,
      action: input.action,
      targetType: input.targetType,
      targetId: input.targetId,
      purpose: input.purpose,
      diff: input.diff,
      fromIp: input.fromIp,
      fromUa: input.fromUa,
      correlationId: input.correlationId,
      prevHash: prevHash || null,
      hash,
    })
    .returning({ id: schema.auditLog.id, hash: schema.auditLog.hash });

  return row ?? null;
}
