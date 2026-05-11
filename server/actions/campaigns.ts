"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { and, eq, inArray } from "drizzle-orm";
import { getDb, schema } from "@/db/client";
import { getSession, hasAtLeastRole } from "@/lib/auth";
import { writeAudit, type AuditAction } from "@/lib/audit";

const IdsSchema = z.object({
  ids: z.array(z.string().uuid()).min(1, "対象を選択してください").max(200),
});

export type BulkActionState = {
  ok: boolean;
  affected: number;
  message?: string;
  /** 件数選択を伴うアクションでは、空配列にリセットする UI ヒント */
  resetSelection?: boolean;
};

export const INITIAL_BULK_STATE: BulkActionState = { ok: false, affected: 0 };

type Outcome =
  | { kind: "fail"; message: string }
  | { kind: "ok"; affected: number };

async function requireManagerSession() {
  const session = await getSession();
  if (!session) return { error: "AUTH_REQUIRED" as const, session: null };
  if (!hasAtLeastRole(session.role, "manager")) {
    return { error: "FORBIDDEN" as const, session };
  }
  return { error: null, session };
}

async function bulkSetStatus(
  formData: FormData,
  nextStatus: "paused" | "running" | "completed",
  auditAction: AuditAction,
  expectedFromStatus?: "running" | "paused"
): Promise<Outcome> {
  const parsed = IdsSchema.safeParse({ ids: formData.getAll("ids").map(String) });
  if (!parsed.success) {
    return { kind: "fail", message: parsed.error.issues[0]?.message ?? "入力が不正です" };
  }
  const { error, session } = await requireManagerSession();
  if (error === "AUTH_REQUIRED" || !session) {
    return { kind: "fail", message: "サインインが必要です" };
  }
  if (error === "FORBIDDEN") {
    return { kind: "fail", message: "この操作は Manager 以上の権限が必要です" };
  }
  const db = getDb();
  if (!db) {
    return { kind: "fail", message: "データベースに接続できません" };
  }

  const conditions = [
    eq(schema.campaigns.orgId, session.orgId),
    inArray(schema.campaigns.id, parsed.data.ids),
  ];
  if (expectedFromStatus) {
    conditions.push(eq(schema.campaigns.status, expectedFromStatus));
  }
  const where = and(...conditions);

  try {
    const updated = await db
      .update(schema.campaigns)
      .set({ status: nextStatus })
      .where(where)
      .returning({ id: schema.campaigns.id, name: schema.campaigns.name });

    // 監査ログは hash chain の直列性保持のため update 後にシリアル発行。
    // Phase2 で writeAuditTx を実装し UPDATE と同一トランザクション化する。
    for (const row of updated) {
      await writeAudit({
        orgId: session.orgId,
        actorUserId: session.userId,
        action: auditAction,
        targetType: "campaign",
        targetId: row.id,
        diff: { status: { from: expectedFromStatus ?? null, to: nextStatus } },
      });
    }

    revalidatePath("/campaigns");
    return { kind: "ok", affected: updated.length };
  } catch (e) {
    if (process.env.NODE_ENV !== "production") {
      console.error("[bulkSetStatus] tx failed", e);
    }
    return {
      kind: "fail",
      message: "処理中に問題が発生しました。時間をおいて再試行してください。",
    };
  }
}

function toState(
  result: Outcome,
  succeedVerb: string,
  fromHint?: string
): BulkActionState {
  if (result.kind === "fail") return { ok: false, affected: 0, message: result.message };
  if (result.affected === 0) {
    return {
      ok: false,
      affected: 0,
      message: fromHint
        ? `対象に ${fromHint} の項目が見つかりませんでした`
        : "対象が見つかりませんでした",
    };
  }
  return {
    ok: true,
    affected: result.affected,
    message: `${result.affected} 件を${succeedVerb}しました`,
    resetSelection: true,
  };
}

export async function bulkPauseCampaigns(
  _prev: BulkActionState | undefined,
  formData: FormData
): Promise<BulkActionState> {
  const result = await bulkSetStatus(formData, "paused", "campaign.paused", "running");
  return toState(result, "一時停止", "実行中");
}

export async function bulkResumeCampaigns(
  _prev: BulkActionState | undefined,
  formData: FormData
): Promise<BulkActionState> {
  const result = await bulkSetStatus(formData, "running", "campaign.resumed", "paused");
  return toState(result, "再開", "一時停止中");
}

export async function bulkArchiveCampaigns(
  _prev: BulkActionState | undefined,
  formData: FormData
): Promise<BulkActionState> {
  const result = await bulkSetStatus(formData, "completed", "campaign.archived");
  return toState(result, "アーカイブ");
}
