"use server";

import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { getDb, schema } from "@/db/client";
import { getSession, hasAtLeastRole } from "@/lib/auth";
import { writeAudit } from "@/lib/audit";
import { rateLimit } from "@/lib/rate-limit";
import { clamp } from "@/lib/utils";

import type { ConnectionActionState } from "@/lib/action-state";
export type { ConnectionActionState };

async function requireAdmin() {
  const session = await getSession();
  if (!session) return { error: "AUTH_REQUIRED" as const, session: null };
  if (!hasAtLeastRole(session.role, "admin")) {
    return { error: "FORBIDDEN" as const, session };
  }
  return { error: null, session };
}

/** lib/rate-limit でアクション単位 × ユーザ単位の連打を抑止 (Phase2 で Redis 化) */
function checkRate(
  key: "pause" | "resume" | "limit" | "disconnect",
  userId: string,
  accountId: string
): ConnectionActionState | null {
  const limits: Record<string, { count: number; windowMs: number }> = {
    pause: { count: 10, windowMs: 60_000 },
    resume: { count: 10, windowMs: 60_000 },
    limit: { count: 20, windowMs: 60_000 },
    disconnect: { count: 3, windowMs: 10 * 60_000 },
  };
  const cfg = limits[key];
  const rl = rateLimit(`conn:${key}:${userId}:${accountId}`, cfg.count, cfg.windowMs);
  if (!rl.ok) {
    return {
      ok: false,
      message: "短時間に操作が集中しています。少し時間をおいてから再度お試しください。",
    };
  }
  return null;
}

const PauseSchema = z.object({
  accountId: z.string().uuid(),
  reason: z.string().trim().min(1, "理由を入力してください").max(400),
});

/** 接続中アカウントを一時停止 (safe_mode へ) */
export async function pauseConnection(
  _prev: ConnectionActionState | undefined,
  formData: FormData
): Promise<ConnectionActionState> {
  const parsed = PauseSchema.safeParse({
    accountId: formData.get("accountId"),
    reason: formData.get("reason"),
  });
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]?.message ?? "入力エラー" };
  }
  const { error, session } = await requireAdmin();
  if (error === "AUTH_REQUIRED" || !session) {
    return { ok: false, message: "サインインが必要です" };
  }
  if (error === "FORBIDDEN") {
    return { ok: false, message: "この操作は Admin 以上の権限が必要です" };
  }
  const rlErr = checkRate("pause", session.userId, parsed.data.accountId);
  if (rlErr) return rlErr;
  const db = getDb();
  if (!db) {
    return { ok: true, message: "(DEMO) 一時停止を受け付けました" };
  }
  try {
    await db.transaction(async (tx) => {
      const updated = await tx
        .update(schema.linkedinAccounts)
        .set({ status: "safe_mode" })
        .where(
          and(
            eq(schema.linkedinAccounts.id, parsed.data.accountId),
            eq(schema.linkedinAccounts.orgId, session.orgId)
          )
        )
        .returning({ id: schema.linkedinAccounts.id });
      if (updated.length === 0) throw new Error("ACCOUNT_NOT_FOUND");
      await writeAudit(
        {
          orgId: session.orgId,
          actorUserId: session.userId,
          action: "linkedin.account_paused",
          targetType: "linkedin_account",
          targetId: parsed.data.accountId,
          purpose: parsed.data.reason,
          diff: { status: { to: "safe_mode" } },
        },
        tx
      );
    });
    revalidatePath("/connections/linkedin");
    return { ok: true, message: "一時停止しました" };
  } catch (e) {
    if (process.env.NODE_ENV !== "production") console.error("[pauseConnection]", e);
    if (e instanceof Error && e.message === "ACCOUNT_NOT_FOUND") {
      return { ok: false, message: "対象のアカウントが見つかりません" };
    }
    return { ok: false, message: "処理中に問題が発生しました" };
  }
}

const ResumeSchema = z.object({
  accountId: z.string().uuid(),
});

export async function resumeConnection(
  _prev: ConnectionActionState | undefined,
  formData: FormData
): Promise<ConnectionActionState> {
  const parsed = ResumeSchema.safeParse({ accountId: formData.get("accountId") });
  if (!parsed.success) return { ok: false, message: "入力エラー" };
  const { error, session } = await requireAdmin();
  if (error === "AUTH_REQUIRED" || !session) return { ok: false, message: "サインインが必要です" };
  if (error === "FORBIDDEN") {
    return { ok: false, message: "この操作は Admin 以上の権限が必要です" };
  }
  const rlErr = checkRate("resume", session.userId, parsed.data.accountId);
  if (rlErr) return rlErr;
  const db = getDb();
  if (!db) return { ok: true, message: "(DEMO) 再開を受け付けました" };

  try {
    await db.transaction(async (tx) => {
      const updated = await tx
        .update(schema.linkedinAccounts)
        .set({ status: "active" })
        .where(
          and(
            eq(schema.linkedinAccounts.id, parsed.data.accountId),
            eq(schema.linkedinAccounts.orgId, session.orgId)
          )
        )
        .returning({ id: schema.linkedinAccounts.id });
      if (updated.length === 0) throw new Error("ACCOUNT_NOT_FOUND");
      await writeAudit(
        {
          orgId: session.orgId,
          actorUserId: session.userId,
          action: "linkedin.account_resumed",
          targetType: "linkedin_account",
          targetId: parsed.data.accountId,
          purpose: "resume_from_safe_mode",
          diff: { status: { to: "active" } },
        },
        tx
      );
    });
    revalidatePath("/connections/linkedin");
    return { ok: true, message: "再開しました" };
  } catch (e) {
    if (process.env.NODE_ENV !== "production") console.error("[resumeConnection]", e);
    if (e instanceof Error && e.message === "ACCOUNT_NOT_FOUND") {
      return { ok: false, message: "対象のアカウントが見つかりません" };
    }
    return { ok: false, message: "処理中に問題が発生しました" };
  }
}

const LimitSchema = z.object({
  accountId: z.string().uuid(),
  dailyLimit: z.coerce.number().int().min(1).max(200),
});

export async function updateDailyLimit(
  _prev: ConnectionActionState | undefined,
  formData: FormData
): Promise<ConnectionActionState> {
  const parsed = LimitSchema.safeParse({
    accountId: formData.get("accountId"),
    dailyLimit: formData.get("dailyLimit"),
  });
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]?.message ?? "入力エラー" };
  }
  const { error, session } = await requireAdmin();
  if (error === "AUTH_REQUIRED" || !session) return { ok: false, message: "サインインが必要です" };
  if (error === "FORBIDDEN") {
    return { ok: false, message: "この操作は Admin 以上の権限が必要です" };
  }
  const rlErr = checkRate("limit", session.userId, parsed.data.accountId);
  if (rlErr) return rlErr;
  const db = getDb();
  if (!db) return { ok: true, message: "(DEMO) 日次上限を保存しました" };

  const next = clamp(parsed.data.dailyLimit, 1, 200);
  try {
    await db.transaction(async (tx) => {
      const updated = await tx
        .update(schema.linkedinAccounts)
        .set({ dailyLimit: next })
        .where(
          and(
            eq(schema.linkedinAccounts.id, parsed.data.accountId),
            eq(schema.linkedinAccounts.orgId, session.orgId)
          )
        )
        .returning({ id: schema.linkedinAccounts.id });
      if (updated.length === 0) throw new Error("ACCOUNT_NOT_FOUND");
      await writeAudit(
        {
          orgId: session.orgId,
          actorUserId: session.userId,
          action: "linkedin.account_limit_changed",
          targetType: "linkedin_account",
          targetId: parsed.data.accountId,
          purpose: "daily_limit_changed",
          diff: { dailyLimit: { to: next } },
        },
        tx
      );
    });
    revalidatePath("/connections/linkedin");
    return { ok: true, message: `日次上限を ${next} 件/日に保存しました` };
  } catch (e) {
    if (process.env.NODE_ENV !== "production") console.error("[updateDailyLimit]", e);
    if (e instanceof Error && e.message === "ACCOUNT_NOT_FOUND") {
      return { ok: false, message: "対象のアカウントが見つかりません" };
    }
    return { ok: false, message: "処理中に問題が発生しました" };
  }
}

const DisconnectSchema = z.object({
  accountId: z.string().uuid(),
  confirm: z.literal("DISCONNECT"),
});

export async function disconnectAccount(
  _prev: ConnectionActionState | undefined,
  formData: FormData
): Promise<ConnectionActionState> {
  const parsed = DisconnectSchema.safeParse({
    accountId: formData.get("accountId"),
    confirm: formData.get("confirm"),
  });
  if (!parsed.success) {
    return {
      ok: false,
      message: "「DISCONNECT」と入力して確認してください",
    };
  }
  const { error, session } = await requireAdmin();
  if (error === "AUTH_REQUIRED" || !session) return { ok: false, message: "サインインが必要です" };
  if (error === "FORBIDDEN") {
    return { ok: false, message: "この操作は Admin 以上の権限が必要です" };
  }
  const rlErr = checkRate("disconnect", session.userId, parsed.data.accountId);
  if (rlErr) return rlErr;
  const db = getDb();
  if (!db) return { ok: true, message: "(DEMO) 接続を切りました" };

  try {
    await db.transaction(async (tx) => {
      const updated = await tx
        .update(schema.linkedinAccounts)
        .set({ status: "disconnected" })
        .where(
          and(
            eq(schema.linkedinAccounts.id, parsed.data.accountId),
            eq(schema.linkedinAccounts.orgId, session.orgId)
          )
        )
        .returning({ id: schema.linkedinAccounts.id });
      if (updated.length === 0) throw new Error("ACCOUNT_NOT_FOUND");
      await writeAudit(
        {
          orgId: session.orgId,
          actorUserId: session.userId,
          action: "linkedin.account_disconnected",
          targetType: "linkedin_account",
          targetId: parsed.data.accountId,
          purpose: "user_initiated_disconnect",
          diff: { status: { to: "disconnected" } },
        },
        tx
      );
    });
    revalidatePath("/connections/linkedin");
    return { ok: true, message: "接続を切りました (7 日以内なら復元可能)" };
  } catch (e) {
    if (process.env.NODE_ENV !== "production") console.error("[disconnectAccount]", e);
    if (e instanceof Error && e.message === "ACCOUNT_NOT_FOUND") {
      return { ok: false, message: "対象のアカウントが見つかりません" };
    }
    return { ok: false, message: "処理中に問題が発生しました" };
  }
}
