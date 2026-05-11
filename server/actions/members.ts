"use server";

import { z } from "zod";
import { and, eq, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { getDb, schema } from "@/db/client";
import { getSession, hasAtLeastRole, type Role } from "@/lib/auth";
import { writeAudit } from "@/lib/audit";
import { rateLimit } from "@/lib/rate-limit";

import type { MemberActionState } from "@/lib/action-state";
export type { MemberActionState };

async function requireAdminOrOwner() {
  const session = await getSession();
  if (!session) return { error: "AUTH_REQUIRED" as const, session: null };
  if (!hasAtLeastRole(session.role, "admin")) return { error: "FORBIDDEN" as const, session };
  return { error: null, session };
}

const RoleSchema = z.enum(["owner", "admin", "manager", "operator", "viewer"]);

const ChangeRoleSchema = z.object({
  userId: z.string().uuid(),
  role: RoleSchema,
});

export async function changeRole(
  _prev: MemberActionState | undefined,
  formData: FormData
): Promise<MemberActionState> {
  const parsed = ChangeRoleSchema.safeParse({
    userId: formData.get("userId"),
    role: formData.get("role"),
  });
  if (!parsed.success) return { ok: false, message: "入力エラー" };
  const { error, session } = await requireAdminOrOwner();
  if (error === "AUTH_REQUIRED" || !session) return { ok: false, message: "サインインが必要です" };
  if (error === "FORBIDDEN") return { ok: false, message: "Admin 以上の権限が必要です" };

  // Owner 昇格・Owner 降格は Owner のみ
  if (parsed.data.role === "owner" && session.role !== "owner") {
    return { ok: false, message: "Owner への昇格は Owner のみが行えます" };
  }
  // 自分自身の Owner から降格を禁止
  if (parsed.data.userId === session.userId && parsed.data.role !== "owner" && session.role === "owner") {
    return { ok: false, message: "自身の Owner 権限は降格できません" };
  }

  const rl = rateLimit(`role:${session.userId}:${parsed.data.userId}`, 5, 60_000);
  if (!rl.ok) return { ok: false, message: "短時間に操作が集中しています。少し時間をおいてください。" };

  const db = getDb();
  if (!db) return { ok: true, message: "(DEMO) ロールを変更しました" };

  try {
    const updated = await db.transaction(async (tx) => {
      // 対象ユーザの現状ロール取得 + 最後の Owner ガード
      const [target] = await tx
        .select({ id: schema.users.id, role: schema.users.role })
        .from(schema.users)
        .where(and(eq(schema.users.id, parsed.data.userId), eq(schema.users.orgId, session.orgId)))
        .limit(1);
      if (!target) throw new Error("USER_NOT_FOUND");

      // Admin が他の Owner を降格しようとした場合は拒否
      if (target.role === "owner" && parsed.data.role !== "owner" && session.role !== "owner") {
        throw new Error("CANNOT_DEMOTE_OWNER");
      }

      // 最後の Owner 維持: Owner → 非Owner 変更時、アクティブな Owner が他に存在することを要求
      if (target.role === "owner" && parsed.data.role !== "owner") {
        const [{ count }] = await tx
          .select({ count: sql<number>`count(*)::int` })
          .from(schema.users)
          .where(
            and(
              eq(schema.users.orgId, session.orgId),
              eq(schema.users.role, "owner"),
              eq(schema.users.isActive, true)
            )
          );
        if (Number(count) <= 1) throw new Error("MUST_KEEP_ONE_OWNER");
      }

      const result = await tx
        .update(schema.users)
        .set({ role: parsed.data.role })
        .where(and(eq(schema.users.id, parsed.data.userId), eq(schema.users.orgId, session.orgId)))
        .returning({ id: schema.users.id, role: schema.users.role });

      await writeAudit(
        {
          orgId: session.orgId,
          actorUserId: session.userId,
          action: "member.role_changed",
          targetType: "user",
          targetId: parsed.data.userId,
          purpose: "role_change",
          diff: { role: { from: target.role, to: parsed.data.role } },
        },
        tx
      );
      return result[0];
    });
    revalidatePath("/settings/team");
    return { ok: true, message: `ロールを ${updated.role} に変更しました` };
  } catch (e) {
    if (process.env.NODE_ENV !== "production") console.error("[changeRole]", e);
    if (e instanceof Error) {
      if (e.message === "USER_NOT_FOUND") return { ok: false, message: "対象のメンバーが見つかりません" };
      if (e.message === "CANNOT_DEMOTE_OWNER") return { ok: false, message: "Owner の降格は他の Owner のみが行えます" };
      if (e.message === "MUST_KEEP_ONE_OWNER") return { ok: false, message: "組織に最低 1 名の Owner が必要です" };
    }
    return { ok: false, message: "処理中に問題が発生しました" };
  }
}

const DeactivateSchema = z.object({ userId: z.string().uuid(), confirm: z.literal("DEACTIVATE") });

export async function deactivateMember(
  _prev: MemberActionState | undefined,
  formData: FormData
): Promise<MemberActionState> {
  const parsed = DeactivateSchema.safeParse({
    userId: formData.get("userId"),
    confirm: formData.get("confirm"),
  });
  if (!parsed.success) {
    return { ok: false, message: "「DEACTIVATE」と入力して確認してください" };
  }
  const { error, session } = await requireAdminOrOwner();
  if (error === "AUTH_REQUIRED" || !session) return { ok: false, message: "サインインが必要です" };
  if (error === "FORBIDDEN") return { ok: false, message: "Admin 以上の権限が必要です" };
  if (parsed.data.userId === session.userId) {
    return { ok: false, message: "自身を無効化することはできません" };
  }

  const db = getDb();
  if (!db) return { ok: true, message: "(DEMO) メンバーを無効化しました" };

  try {
    await db.transaction(async (tx) => {
      const [target] = await tx
        .select({ id: schema.users.id, role: schema.users.role, isActive: schema.users.isActive })
        .from(schema.users)
        .where(and(eq(schema.users.id, parsed.data.userId), eq(schema.users.orgId, session.orgId)))
        .limit(1);
      if (!target) throw new Error("USER_NOT_FOUND");

      // Owner を無効化する場合は他にアクティブな Owner が存在する必要がある
      if (target.role === "owner") {
        if (session.role !== "owner") throw new Error("CANNOT_DEMOTE_OWNER");
        const [{ count }] = await tx
          .select({ count: sql<number>`count(*)::int` })
          .from(schema.users)
          .where(
            and(
              eq(schema.users.orgId, session.orgId),
              eq(schema.users.role, "owner"),
              eq(schema.users.isActive, true)
            )
          );
        if (Number(count) <= 1) throw new Error("MUST_KEEP_ONE_OWNER");
      }

      await tx
        .update(schema.users)
        .set({ isActive: false })
        .where(and(eq(schema.users.id, parsed.data.userId), eq(schema.users.orgId, session.orgId)));

      await writeAudit(
        {
          orgId: session.orgId,
          actorUserId: session.userId,
          action: "member.deactivated",
          targetType: "user",
          targetId: parsed.data.userId,
          purpose: "deactivate",
          diff: { isActive: { from: target.isActive, to: false } },
        },
        tx
      );
    });
    revalidatePath("/settings/team");
    return { ok: true, message: "メンバーを無効化しました (退職者ハンドオフは Phase2 で実装)" };
  } catch (e) {
    if (process.env.NODE_ENV !== "production") console.error("[deactivateMember]", e);
    if (e instanceof Error) {
      if (e.message === "USER_NOT_FOUND") return { ok: false, message: "対象のメンバーが見つかりません" };
      if (e.message === "CANNOT_DEMOTE_OWNER") return { ok: false, message: "Owner の無効化は他の Owner のみが行えます" };
      if (e.message === "MUST_KEEP_ONE_OWNER") return { ok: false, message: "組織に最低 1 名のアクティブな Owner が必要です" };
    }
    return { ok: false, message: "処理中に問題が発生しました" };
  }
}
