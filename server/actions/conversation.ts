"use server";

import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { getDb, schema } from "@/db/client";
import { getSession, hasAtLeastRole } from "@/lib/auth";
import { writeAudit } from "@/lib/audit";
import { detectDlpViolation } from "@/lib/dlp";
import { rateLimit } from "@/lib/rate-limit";

import type { SendResult } from "@/lib/action-state";
export type { SendResult };

const SendSchema = z.object({
  leadId: z.string().uuid(),
  content: z
    .string()
    .trim()
    .min(1, "本文を入力してください")
    .max(1500, "1500 文字以内に収めてください"),
  aiAssisted: z.coerce.boolean().optional().default(false),
});

async function requireOperator() {
  const session = await getSession();
  if (!session) return { error: "AUTH_REQUIRED" as const, session: null };
  if (!hasAtLeastRole(session.role, "operator")) {
    return { error: "FORBIDDEN" as const, session };
  }
  return { error: null, session };
}

/**
 * メッセージ送信 (確定書き込み)。
 * UI 側で 5 秒キュー Undo を完了した後にここを叩く。
 * - leads.org_id を WHERE 句で強制
 * - messages を INSERT + lead.state を遷移 + audit を同一 transaction
 */
export async function sendMessage(
  _prev: SendResult | undefined,
  formData: FormData
): Promise<SendResult> {
  const parsed = SendSchema.safeParse({
    leadId: formData.get("leadId"),
    content: formData.get("content"),
    aiAssisted: formData.get("aiAssisted") ?? false,
  });
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]?.message ?? "入力エラー" };
  }

  // 機微情報 / 価格条件の検知 (設計書 §17.5) — NFKC normalize で全角・互換文字も拾う
  const danger = detectDlpViolation(parsed.data.content);
  if (danger) {
    return {
      ok: false,
      message: `${danger.reason} が含まれています。Manager 以上の承認が必要です (Phase2 で承認フロー)`,
    };
  }

  const { error, session } = await requireOperator();
  if (error === "AUTH_REQUIRED" || !session) {
    return { ok: false, message: "サインインが必要です" };
  }
  if (error === "FORBIDDEN") {
    return { ok: false, message: "この操作の権限がありません" };
  }

  // user × lead 単位でレート制限 (5 件 / 60 秒、LinkedIn 規約準拠)
  const rl = rateLimit(`send:${session.userId}:${parsed.data.leadId}`, 5, 60_000);
  if (!rl.ok) {
    return {
      ok: false,
      message: "短時間に送信が集中しています。少し時間をおいてから再度お試しください。",
    };
  }

  const db = getDb();
  if (!db) {
    // DEMO モード: 永続化はしない
    return {
      ok: true,
      messageId: `demo-${Date.now()}`,
      message: "(DEMO) 送信を受け付けました。DB 未接続のため永続化されません。",
    };
  }

  try {
    const messageId = await db.transaction(async (tx) => {
      // org スコープを持つ lead を取得 (確認 + state 遷移)
      const [lead] = await tx
        .select({ id: schema.leads.id, state: schema.leads.state })
        .from(schema.leads)
        .where(and(eq(schema.leads.id, parsed.data.leadId), eq(schema.leads.orgId, session.orgId)))
        .limit(1);
      if (!lead) throw new Error("LEAD_NOT_FOUND");

      const [inserted] = await tx
        .insert(schema.messages)
        .values({
          leadId: lead.id,
          direction: "outbound",
          content: parsed.data.content,
          aiAssisted: parsed.data.aiAssisted ?? false,
        })
        .returning({ id: schema.messages.id });

      // 状態遷移: PENDING/CONNECTED 等 → MESSAGED へ進める
      const nextState = lead.state === "REPLIED" ? "REPLIED" : "MESSAGED";
      await tx
        .update(schema.leads)
        .set({ state: nextState, lastActionAt: new Date() })
        .where(eq(schema.leads.id, lead.id));

      await writeAudit(
        {
          orgId: session.orgId,
          actorUserId: session.userId,
          action: "message.sent",
          targetType: "lead",
          targetId: lead.id,
          diff: {
            messageId: inserted.id,
            aiAssisted: parsed.data.aiAssisted,
            length: parsed.data.content.length,
          },
        },
        tx
      );

      return inserted.id;
    });

    revalidatePath(`/inbox/${parsed.data.leadId}`);
    revalidatePath("/inbox");
    return { ok: true, messageId, message: "メッセージを送信しました" };
  } catch (e) {
    if (process.env.NODE_ENV !== "production") console.error("[sendMessage]", e);
    if (e instanceof Error && e.message === "LEAD_NOT_FOUND") {
      return { ok: false, message: "対象のリードが見つかりません" };
    }
    return { ok: false, message: "送信中に問題が発生しました" };
  }
}

/** 商談化: 状態を MEETING に遷移 */
const MeetingSchema = z.object({
  leadId: z.string().uuid(),
  note: z.string().trim().max(400).optional().or(z.literal("")),
});

export async function markAsMeeting(
  _prev: SendResult | undefined,
  formData: FormData
): Promise<SendResult> {
  const parsed = MeetingSchema.safeParse({
    leadId: formData.get("leadId"),
    note: formData.get("note") ?? "",
  });
  if (!parsed.success) {
    return { ok: false, message: "入力エラー" };
  }

  const { error, session } = await requireOperator();
  if (error === "AUTH_REQUIRED" || !session) {
    return { ok: false, message: "サインインが必要です" };
  }
  if (error === "FORBIDDEN") {
    return { ok: false, message: "この操作の権限がありません" };
  }

  const db = getDb();
  if (!db) {
    return { ok: true, message: "(DEMO) 商談化として記録しました" };
  }

  try {
    await db.transaction(async (tx) => {
      const updated = await tx
        .update(schema.leads)
        .set({ state: "MEETING", lastActionAt: new Date() })
        .where(
          and(
            eq(schema.leads.id, parsed.data.leadId),
            eq(schema.leads.orgId, session.orgId)
          )
        )
        .returning({ id: schema.leads.id });
      if (updated.length === 0) throw new Error("LEAD_NOT_FOUND");

      await writeAudit(
        {
          orgId: session.orgId,
          actorUserId: session.userId,
          action: "lead.requalified",
          targetType: "lead",
          targetId: updated[0].id,
          diff: { state: { to: "MEETING" }, note: parsed.data.note || null },
        },
        tx
      );
    });

    revalidatePath(`/inbox/${parsed.data.leadId}`);
    revalidatePath("/inbox");
    return { ok: true, message: "商談化として記録しました" };
  } catch (e) {
    if (process.env.NODE_ENV !== "production") console.error("[markAsMeeting]", e);
    if (e instanceof Error && e.message === "LEAD_NOT_FOUND") {
      return { ok: false, message: "対象のリードが見つかりません" };
    }
    return { ok: false, message: "処理中に問題が発生しました" };
  }
}
