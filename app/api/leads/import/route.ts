import "server-only";
import { NextResponse, type NextRequest } from "next/server";
import { and, eq, inArray } from "drizzle-orm";
import { getDb, schema } from "@/db/client";
import { getSession, hasAtLeastRole } from "@/lib/auth";
import { writeAudit } from "@/lib/audit";
import { rateLimit } from "@/lib/rate-limit";
import { parseLeadsCsv, normalizeLinkedinUrl, type LeadRow } from "@/lib/csv/lead-parser";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * CSV Bulk Import.
 *
 * - POST multipart/form-data: field `file` (CSV, max 10MB)
 * - 認証: operator 以上
 * - レート制限: org × 1 req/min
 * - 重複排除: (org_id, linkedin_url) UNIQUE で ON CONFLICT DO NOTHING
 * - 監査: leads.imported (single bulk entry)
 */

const MAX_BYTES = 10 * 1024 * 1024;
const ACCEPTED_MIME = new Set([
  "text/csv",
  "application/csv",
  "application/vnd.ms-excel",
  "text/plain",
  "",
  "application/octet-stream",
]);

type ImportSummary = {
  inserted: number;
  skipped: number;
  errors: Array<{ row: number; message: string }>;
};

export async function POST(req: NextRequest): Promise<NextResponse> {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ message: "サインインが必要です" }, { status: 401 });
  }
  if (!hasAtLeastRole(session.role, "operator")) {
    return NextResponse.json({ message: "この操作の権限がありません" }, { status: 403 });
  }

  const rl = rateLimit(`leads.import:${session.orgId}`, 1, 60_000);
  if (!rl.ok) {
    return NextResponse.json(
      { message: "短時間に連続実行されました。1 分後に再試行してください。" },
      {
        status: 429,
        headers: {
          "Retry-After": String(Math.max(1, Math.ceil((rl.resetAt - Date.now()) / 1000))),
        },
      }
    );
  }

  const ctype = req.headers.get("content-type") ?? "";
  if (!ctype.toLowerCase().startsWith("multipart/form-data")) {
    return NextResponse.json(
      { message: "multipart/form-data で送信してください" },
      { status: 400 }
    );
  }

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ message: "リクエストの解析に失敗しました" }, { status: 400 });
  }

  const file = form.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ message: "file フィールドが必要です" }, { status: 400 });
  }
  if (file.size === 0) {
    return NextResponse.json({ message: "空のファイルです" }, { status: 400 });
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json(
      { message: `ファイルサイズが上限 (${MAX_BYTES / 1024 / 1024}MB) を超えています` },
      { status: 413 }
    );
  }
  if (file.type && !ACCEPTED_MIME.has(file.type.toLowerCase())) {
    if (!/\.csv$/i.test(file.name)) {
      return NextResponse.json(
        { message: "CSV ファイル (.csv) を指定してください" },
        { status: 400 }
      );
    }
  }

  const text = await file.text();
  const parsed = parseLeadsCsv(text);
  const errors: ImportSummary["errors"] = [...parsed.errors];

  if (parsed.rows.length === 0 && errors.length === 0) {
    return NextResponse.json(
      { message: "取り込み可能な行がありません" },
      { status: 400 }
    );
  }
  if (parsed.rows.length > 100_000) {
    return NextResponse.json(
      { message: "行数が上限 (100,000) を超えています" },
      { status: 413 }
    );
  }

  const db = getDb();
  if (!db) {
    return NextResponse.json({ message: "データベースに接続できません" }, { status: 500 });
  }

  try {
    const uniqueCampaignNames = Array.from(
      new Set(parsed.rows.map((r) => r.campaign_name).filter(Boolean))
    );

    const campaignRows = uniqueCampaignNames.length
      ? await db
          .select({ id: schema.campaigns.id, name: schema.campaigns.name })
          .from(schema.campaigns)
          .where(
            and(
              eq(schema.campaigns.orgId, session.orgId),
              inArray(schema.campaigns.name, uniqueCampaignNames)
            )
          )
      : [];
    const campaignIdByName = new Map(campaignRows.map((c) => [c.name, c.id]));

    type InsertRow = typeof schema.leads.$inferInsert;
    const seenUrls = new Set<string>();
    const values: InsertRow[] = [];

    for (const row of parsed.rows) {
      const campaignId = campaignIdByName.get(row.campaign_name);
      if (!campaignId) {
        errors.push({
          row: row.lineNumber,
          message: `キャンペーンが見つかりません: ${row.campaign_name}`,
        });
        continue;
      }
      const normalizedUrl = normalizeLinkedinUrl(row.linkedinUrl ?? row.public_id);
      if (!normalizedUrl) {
        errors.push({
          row: row.lineNumber,
          message: "linkedin URL を正規化できません",
        });
        continue;
      }
      if (seenUrls.has(normalizedUrl)) continue;
      seenUrls.add(normalizedUrl);

      values.push({
        orgId: session.orgId,
        campaignId,
        linkedinUrl: normalizedUrl,
        fullName: row.full_name?.slice(0, 160) || null,
        headline: row.title?.slice(0, 256) || null,
        company: row.company?.slice(0, 160) || null,
        state: "DISCOVERED",
        metadata: {
          sourceAccount: row.source_account ?? null,
          legacyLeadId: row.legacy_lead_id ?? null,
          location: row.location ?? null,
          linkedinStatus: row.linkedin_status ?? null,
          linkedinConnectedAt: row.linkedin_connected_at ?? null,
          linkedinDmSentAt: row.linkedin_dm_sent_at ?? null,
          importedAt: new Date().toISOString(),
        },
      });
    }

    let inserted = 0;
    const attempted = values.length;

    if (values.length > 0) {
      const CHUNK = 1000;
      await db.transaction(async (tx) => {
        for (let i = 0; i < values.length; i += CHUNK) {
          const chunk = values.slice(i, i + CHUNK);
          const ret = await tx
            .insert(schema.leads)
            .values(chunk)
            .onConflictDoNothing({
              target: [schema.leads.orgId, schema.leads.linkedinUrl],
            })
            .returning({ id: schema.leads.id });
          inserted += ret.length;
        }

        await writeAudit(
          {
            orgId: session.orgId,
            actorUserId: session.userId,
            action: "leads.imported",
            targetType: "lead",
            targetId: `bulk:${inserted}`,
            diff: {
              file_name: file.name,
              file_size: file.size,
              rows_in_csv: parsed.rows.length,
              rows_attempted: attempted,
              rows_inserted: inserted,
              rows_skipped: attempted - inserted,
              parse_errors: parsed.errors.length,
              campaigns: uniqueCampaignNames,
            },
            fromIp:
              req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
              req.headers.get("x-real-ip") ||
              undefined,
            fromUa: req.headers.get("user-agent") ?? undefined,
          },
          tx
        );
      });
    }

    const summary: ImportSummary = {
      inserted,
      skipped:
        attempted - inserted + (parsed.rows.length - attempted - parsed.errors.length),
      errors,
    };

    return NextResponse.json(summary, {
      status: 200,
      headers: { "Cache-Control": "no-store", "X-Robots-Tag": "noindex" },
    });
  } catch (e) {
    if (process.env.NODE_ENV !== "production") {
      console.error("[leads.import] failed", e);
    }
    return NextResponse.json(
      { message: "インポート中に問題が発生しました" },
      { status: 500 }
    );
  }
}

export async function GET() {
  return NextResponse.json({ message: "Method Not Allowed" }, { status: 405 });
}

export type { ImportSummary, LeadRow };
