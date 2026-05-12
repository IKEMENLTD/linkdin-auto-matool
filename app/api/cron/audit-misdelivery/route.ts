import { NextResponse, type NextRequest } from "next/server";
import { and, eq, gte, sql } from "drizzle-orm";
import { z } from "zod";
import { getDb, schema } from "@/db/client";
import { writeAudit } from "@/lib/audit";
import { newCorrelationId, newIncidentId } from "@/lib/incident";
import {
  detectMismatch,
  extractPublicIdFromUrl,
  publicIdSchema,
  urnSchema,
} from "@/lib/safety/mismatch-detector";
import { sendSlackAlert } from "@/lib/notifications/slack";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** 監査対象ウィンドウ: 過去 N 日 */
const AUDIT_WINDOW_DAYS = 7;

/** 1 回の cron で処理する outbound message の上限 (DoS 自己防衛) */
const MAX_MESSAGES_PER_RUN = 5_000;

const messageMetadataSchema = z.object({
  recipientUrn: urnSchema.optional().nullable(),
  recipientPublicId: publicIdSchema.optional().nullable(),
  unipileMessageId: z.string().min(1).max(128).optional().nullable(),
  unipileAccountId: z.string().min(1).max(64).optional().nullable(),
});

interface AuditRowJoined {
  messageId: string;
  leadId: string;
  orgId: string;
  campaignId: string;
  linkedinUrl: string;
  sentAt: Date;
  metadata: Record<string, unknown> | null;
}

interface RunSummary {
  checked: number;
  mismatches: number;
  warnings: number;
  haltedOrgIds: string[];
  errors: number;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  incidentIds: string[];
}

/**
 * Unipile から実際の送信先 public_id を逆引きする。
 * TODO: 実 API client (lib/unipile/client.ts) を別 PR で導入する。
 * 現状は metadata に保存された値を信頼する fallback 実装。
 */
async function lookupActualRecipient(
  metadata: Record<string, unknown> | null
): Promise<{ publicId: string | null; urn: string | null }> {
  if (!metadata) return { publicId: null, urn: null };

  const parsed = messageMetadataSchema.safeParse(metadata);
  if (!parsed.success) return { publicId: null, urn: null };

  return {
    publicId: parsed.data.recipientPublicId ?? null,
    urn: parsed.data.recipientUrn ?? null,
  };
}

/**
 * Daily audit cron — URN mismatch 検知 + global halt + Slack alert.
 *
 *   起動: Vercel cron (UTC 18:00 = JST 03:00, vercel.json)
 *   認証: Authorization: Bearer ${CRON_SECRET}
 */
export async function GET(request: NextRequest) {
  const startedAt = Date.now();
  const startedAtIso = new Date(startedAt).toISOString();
  const correlationId = newCorrelationId();

  // 1) 認証
  const expected = process.env.CRON_SECRET;
  if (!expected || expected.length < 16) {
    return NextResponse.json(
      { error: "CRON_SECRET is not configured" },
      { status: 503 }
    );
  }
  const authHeader = request.headers.get("authorization") ?? "";
  const presented = authHeader.startsWith("Bearer ")
    ? authHeader.slice(7).trim()
    : "";
  if (
    presented.length !== expected.length ||
    !timingSafeEqual(presented, expected)
  ) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  // 2) DB
  const db = getDb();
  if (!db) {
    return NextResponse.json(
      { error: "database is not configured" },
      { status: 503 }
    );
  }

  // 3) 対象 message 取得
  const sinceDate = new Date(startedAt - AUDIT_WINDOW_DAYS * 24 * 60 * 60 * 1000);

  let rows: AuditRowJoined[] = [];
  try {
    const fetched = await db
      .select({
        messageId: schema.messages.id,
        leadId: schema.messages.leadId,
        orgId: schema.leads.orgId,
        campaignId: schema.leads.campaignId,
        linkedinUrl: schema.leads.linkedinUrl,
        sentAt: schema.messages.sentAt,
        metadata: schema.leads.metadata,
      })
      .from(schema.messages)
      .innerJoin(schema.leads, eq(schema.leads.id, schema.messages.leadId))
      .where(
        and(
          eq(schema.messages.direction, "outbound"),
          gte(schema.messages.sentAt, sinceDate)
        )
      )
      .limit(MAX_MESSAGES_PER_RUN);

    rows = fetched as AuditRowJoined[];
  } catch (e) {
    return NextResponse.json(
      {
        error: "query_failed",
        message: e instanceof Error ? e.message : String(e),
      },
      { status: 500 }
    );
  }

  // 4) 検査
  const summary: RunSummary = {
    checked: 0,
    mismatches: 0,
    warnings: 0,
    haltedOrgIds: [],
    errors: 0,
    startedAt: startedAtIso,
    finishedAt: "",
    durationMs: 0,
    incidentIds: [],
  };

  const orgsToHalt = new Set<string>();

  for (const row of rows) {
    summary.checked += 1;

    try {
      const expectedPublicId = extractPublicIdFromUrl(row.linkedinUrl);
      const actual = await lookupActualRecipient(row.metadata);

      const result = detectMismatch({
        expectedPublicId,
        actualPublicId: actual.publicId,
        actualUrn: actual.urn,
      });

      if (result.ok) continue;

      // インシデント記録
      const incidentId = newIncidentId();
      const severity = result.severity;
      const payload = {
        messageId: row.messageId,
        leadId: row.leadId,
        campaignId: row.campaignId,
        sentAt: row.sentAt.toISOString(),
        expected: result.expected,
        actual: result.actual,
        reason: result.reason,
      };

      await db.execute(sql`
        insert into incident_log (org_id, incident_id, severity, payload)
        values (${row.orgId}, ${incidentId}, ${severity}, ${JSON.stringify(payload)}::jsonb)
      `);

      summary.incidentIds.push(incidentId);

      if (severity === "critical") {
        summary.mismatches += 1;
        orgsToHalt.add(row.orgId);
      } else {
        summary.warnings += 1;
      }

      // 監査ログ
      await writeAudit({
        orgId: row.orgId,
        action: "CIRCUIT_BREAKER",
        targetType: "message",
        targetId: row.messageId,
        purpose: `urn_mismatch_detected:${result.reason}`,
        diff: payload,
        correlationId,
      });

      // Slack (fail-soft)
      const slackResult = await sendSlackAlert("#linkedin-incidents", {
        title:
          severity === "critical"
            ? `[CRITICAL] URN mismatch detected — global halt fired`
            : `[WARNING] URN audit anomaly`,
        incidentId,
        orgId: row.orgId,
        severity,
        fields: [
          { label: "messageId", value: row.messageId },
          { label: "leadId", value: row.leadId },
          { label: "expected", value: result.expected ?? "(null)" },
          { label: "actual", value: result.actual ?? "(null)" },
          { label: "reason", value: result.reason },
          { label: "sentAt", value: row.sentAt.toISOString() },
        ],
      });

      if (!slackResult.ok) {
        await writeAudit({
          orgId: row.orgId,
          action: "CIRCUIT_BREAKER",
          targetType: "slack",
          targetId: incidentId,
          purpose: "slack_notify_failed",
          diff: { error: slackResult.error, status: slackResult.status ?? null },
          correlationId,
        });
      }
    } catch (e) {
      summary.errors += 1;
      try {
        await writeAudit({
          orgId: row.orgId,
          action: "CIRCUIT_BREAKER",
          targetType: "cron",
          targetId: row.messageId,
          purpose: "audit_message_failed",
          diff: { error: e instanceof Error ? e.message : String(e) },
          correlationId,
        });
      } catch {
        // swallow
      }
    }
  }

  // 5) Global halt
  if (orgsToHalt.size > 0) {
    const haltedAt = new Date(startedAt).toISOString();
    for (const orgId of orgsToHalt) {
      try {
        await db.execute(sql`
          update organizations
             set global_halt_at = ${haltedAt}::timestamptz
           where id = ${orgId}::uuid
             and global_halt_at is null
        `);
        summary.haltedOrgIds.push(orgId);

        await writeAudit({
          orgId,
          action: "BREAK_GLASS",
          targetType: "organization",
          targetId: orgId,
          purpose: "global_halt_due_to_urn_mismatch",
          diff: { haltedAt, source: "cron/audit-misdelivery" },
          correlationId,
        });
      } catch (e) {
        summary.errors += 1;
        await writeAudit({
          orgId,
          action: "BREAK_GLASS",
          targetType: "organization",
          targetId: orgId,
          purpose: "global_halt_failed",
          diff: { error: e instanceof Error ? e.message : String(e) },
          correlationId,
        }).catch(() => {});
      }
    }
  }

  // 6) 完了
  const finishedAt = Date.now();
  summary.finishedAt = new Date(finishedAt).toISOString();
  summary.durationMs = finishedAt - startedAt;

  return NextResponse.json({
    ok: true,
    correlationId,
    ...summary,
  });
}

/**
 * 定数時間文字列比較 (timing attack 対策)。
 */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}
