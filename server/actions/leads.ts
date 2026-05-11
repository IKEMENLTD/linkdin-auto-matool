"use server";

import { z } from "zod";
import { and, eq, inArray } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { getDb, schema } from "@/db/client";
import { getSession, hasAtLeastRole } from "@/lib/auth";
import { writeAudit } from "@/lib/audit";

export type LeadBulkState = {
  ok: boolean;
  affected: number;
  message?: string;
  resetSelection?: boolean;
};

export const INITIAL_LEAD_BULK_STATE: LeadBulkState = { ok: false, affected: 0 };

const IdsSchema = z.object({
  ids: z.array(z.string().uuid()).min(1, "対象を選択してください").max(500),
});

async function requireOperatorSession() {
  const session = await getSession();
  if (!session) return { error: "AUTH_REQUIRED" as const, session: null };
  if (!hasAtLeastRole(session.role, "operator")) {
    return { error: "FORBIDDEN" as const, session };
  }
  return { error: null, session };
}

export async function bulkDisqualifyLeads(
  _prev: LeadBulkState | undefined,
  formData: FormData
): Promise<LeadBulkState> {
  const parsed = IdsSchema.safeParse({ ids: formData.getAll("ids").map(String) });
  if (!parsed.success) {
    return { ok: false, affected: 0, message: parsed.error.issues[0]?.message ?? "入力エラー" };
  }
  const { error, session } = await requireOperatorSession();
  if (error === "AUTH_REQUIRED" || !session) {
    return { ok: false, affected: 0, message: "サインインが必要です" };
  }
  if (error === "FORBIDDEN") {
    return { ok: false, affected: 0, message: "この操作の権限がありません" };
  }
  const db = getDb();
  if (!db) {
    return { ok: false, affected: 0, message: "データベースに接続できません" };
  }

  try {
    // UPDATE と audit_log INSERT を同一 transaction で行い、改竄耐性 (§17) を担保。
    // 500 件 N+1 + hash chain race を避けるため、bulk は 1 entry にまとめる。
    const { updated } = await db.transaction(async (tx) => {
      const updatedRows = await tx
        .update(schema.leads)
        .set({ state: "DISQUALIFIED" })
        .where(
          and(
            eq(schema.leads.orgId, session.orgId),
            inArray(schema.leads.id, parsed.data.ids)
          )
        )
        .returning({ id: schema.leads.id });

      if (updatedRows.length === 0) return { updated: updatedRows };

      await writeAudit(
        {
          orgId: session.orgId,
          actorUserId: session.userId,
          action: "lead.bulk_disqualified",
          targetType: "lead",
          targetId:
            updatedRows.length === 1
              ? updatedRows[0].id
              : `bulk:${updatedRows.length}`,
          diff: {
            state: { to: "DISQUALIFIED" },
            target_ids: updatedRows.map((r) => r.id),
            requested_count: parsed.data.ids.length,
          },
        },
        tx
      );

      return { updated: updatedRows };
    });

    revalidatePath("/leads");
    return {
      ok: updated.length > 0,
      affected: updated.length,
      message:
        updated.length > 0
          ? `${updated.length} 件を除外しました`
          : "対象が見つかりませんでした",
      resetSelection: updated.length > 0,
    };
  } catch (e) {
    if (process.env.NODE_ENV !== "production") console.error("[bulkDisqualifyLeads]", e);
    return { ok: false, affected: 0, message: "処理中に問題が発生しました" };
  }
}
