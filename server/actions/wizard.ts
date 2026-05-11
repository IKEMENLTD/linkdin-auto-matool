"use server";

import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { getDb, schema } from "@/db/client";
import { getSession, hasAtLeastRole } from "@/lib/auth";
import { writeAudit } from "@/lib/audit";
import {
  Step2Schema,
  Step3Schema,
  Step4Schema,
  Step5Schema,
  Step1Schema,
  WizardSchema,
  WARMUP_DAILY_CAP_BY_DAY,
  type WizardState,
} from "@/lib/wizard-schema";

export type WizardActionState = {
  ok: boolean;
  message?: string;
  field?: string;
  draftId?: string;
  redirectTo?: string;
};

const INITIAL: WizardActionState = { ok: false };
export const INITIAL_WIZARD_STATE = INITIAL;

const STATE_MAX_BYTES = 32 * 1024; // 32KB

/** state JSON を安全にパースする (サイズ上限 + try/catch) */
function safeParseState(raw: string): { ok: true; state: WizardState } | { ok: false; reason: string } {
  if (raw.length > STATE_MAX_BYTES) return { ok: false, reason: "下書きの容量が大きすぎます" };
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ok: false, reason: "下書きの形式が正しくありません" };
  }
  const r = WizardSchema.safeParse(parsed);
  if (!r.success) return { ok: false, reason: "下書きの内容が不正です" };
  return { ok: true, state: r.data };
}

/** ウォームアップ段階に応じて日次上限を押し戻す */
function clampDailyLimitByWarmup(
  request: number,
  selectedWarmupDays: number[]
): number {
  if (selectedWarmupDays.length === 0) return request;
  const cap = Math.min(...selectedWarmupDays.map((d) => WARMUP_DAILY_CAP_BY_DAY(d)));
  return Math.min(request, cap);
}

/** Draft 自動保存 */
export async function saveDraft(
  _prev: WizardActionState | undefined,
  formData: FormData
): Promise<WizardActionState> {
  const session = await getSession();
  if (!session) {
    return { ok: true, message: "ローカル下書きとして保存しました" };
  }
  if (!hasAtLeastRole(session.role, "operator")) {
    return { ok: false, message: "この操作の権限がありません" };
  }

  const raw = String(formData.get("state") ?? "");
  const parsed = safeParseState(raw);
  if (!parsed.ok) return { ok: false, message: parsed.reason };

  const name = parsed.state.step2?.companyName?.trim() || "(未命名のキャンペーン)";
  const icp = parsed.state.step3
    ? `Titles: ${parsed.state.step3.jobTitles.join(", ")} / Headcount: ${parsed.state.step3.headcountMin}-${parsed.state.step3.headcountMax}`
    : "";

  const db = getDb();
  if (!db) {
    return { ok: true, message: "ローカル下書きとして保存しました" };
  }

  try {
    const draftIdRaw = String(formData.get("draftId") ?? "");
    const isUuid = /^[0-9a-fA-F-]{36}$/.test(draftIdRaw);
    const draftId = isUuid ? draftIdRaw : "";

    let row;
    if (draftId) {
      row = await db
        .update(schema.campaigns)
        .set({
          name,
          icpDescription: icp,
          productDocs: parsed.state as Record<string, unknown>,
        })
        .where(
          and(
            eq(schema.campaigns.id, draftId),
            eq(schema.campaigns.orgId, session.orgId),
            eq(schema.campaigns.status, "draft")
          )
        )
        .returning({ id: schema.campaigns.id });
    } else {
      row = await db
        .insert(schema.campaigns)
        .values({
          orgId: session.orgId,
          name,
          icpDescription: icp,
          productDocs: parsed.state as Record<string, unknown>,
          status: "draft",
          ownerUserId: session.userId,
        })
        .returning({ id: schema.campaigns.id });
    }
    const id = row[0]?.id;
    return { ok: true, draftId: id, message: "下書きを保存しました" };
  } catch (e) {
    if (process.env.NODE_ENV !== "production") console.error("[saveDraft]", e);
    return { ok: false, message: "下書きの保存中に問題が発生しました" };
  }
}

const LaunchInputSchema = z.object({
  state: z.string().min(1).max(STATE_MAX_BYTES),
  draftId: z.string().uuid().optional().or(z.literal("")),
});

export async function launchCampaign(
  _prev: WizardActionState | undefined,
  formData: FormData
): Promise<WizardActionState> {
  const session = await getSession();
  if (!session) return { ok: false, message: "サインインが必要です" };
  if (!hasAtLeastRole(session.role, "manager")) {
    return { ok: false, message: "キャンペーンのローンチは Manager 以上の権限が必要です" };
  }

  const parsedInput = LaunchInputSchema.safeParse({
    state: formData.get("state"),
    draftId: formData.get("draftId") ?? "",
  });
  if (!parsedInput.success) return { ok: false, message: "送信内容が不正です" };

  const safe = safeParseState(parsedInput.data.state);
  if (!safe.ok) return { ok: false, message: safe.reason };
  const state = safe.state;

  // 全 step を最終バリデーション
  const r1 = Step1Schema.safeParse(state.step1);
  const r2 = Step2Schema.safeParse(state.step2);
  const r3 = Step3Schema.safeParse(state.step3);
  const r4 = Step4Schema.safeParse(state.step4);
  const r5 = Step5Schema.safeParse(state.step5);
  const issues: string[] = [];
  if (!r1.success) issues.push("目的");
  if (!r2.success) issues.push("商品 / 会社");
  if (!r3.success) issues.push("ICP");
  if (!r4.success) issues.push("メッセージ");
  if (!r5.success) issues.push("配信設定");
  if (issues.length > 0) {
    return { ok: false, message: `未入力の項目があります: ${issues.join(" / ")}` };
  }

  const db = getDb();
  if (!db || !r2.success || !r3.success || !r4.success || !r5.success) {
    return {
      ok: true,
      message: "(DEMO) ローンチ操作を受け付けました。DB 未接続のため永続化されません。",
    };
  }

  const name = r2.data.companyName.trim();
  const icp = `Titles: ${r3.data.jobTitles.join(", ")} / Headcount: ${r3.data.headcountMin}-${r3.data.headcountMax}`;

  // 担当アカウントの warmupDay 取得 + 押し戻し
  let campaignId: string | undefined;
  try {
    const accountRows = await db
      .select({ id: schema.linkedinAccounts.id, warmupDay: schema.linkedinAccounts.warmupDay })
      .from(schema.linkedinAccounts)
      .where(
        and(
          eq(schema.linkedinAccounts.orgId, session.orgId)
        )
      );
    const allowed = accountRows.filter((a) => r5.data.accountIds.includes(a.id));
    if (allowed.length === 0) {
      return { ok: false, message: "選択したアカウントがこの組織に存在しません" };
    }
    const effectiveDaily = clampDailyLimitByWarmup(
      r5.data.dailyLimit,
      allowed.map((a) => a.warmupDay)
    );

    const productDocs: Record<string, unknown> = {
      objective: r1.success ? r1.data.objective : undefined,
      product: r2.data,
      icp: r3.data,
      message: r4.data,
      delivery: {
        accountIds: r5.data.accountIds,
        dailyLimit: r5.data.dailyLimit,
        effectiveDailyLimit: effectiveDaily,
        startTime: r5.data.startTime,
        endTime: r5.data.endTime,
        weekdaysOnly: r5.data.weekdaysOnly,
        reviewMode: r5.data.reviewMode,
      },
    };

    const draftIdRaw = parsedInput.data.draftId || "";
    if (draftIdRaw) {
      const upd = await db
        .update(schema.campaigns)
        .set({
          name,
          icpDescription: icp,
          status: "running",
          startsAt: new Date(r5.data.startsAt),
          hitlState: r5.data.reviewMode === "semi_auto" ? "SEMI_AUTO" : "REVIEW_REQUIRED",
          productDocs,
        })
        .where(and(eq(schema.campaigns.id, draftIdRaw), eq(schema.campaigns.orgId, session.orgId)))
        .returning({ id: schema.campaigns.id });
      campaignId = upd[0]?.id;
    } else {
      const ins = await db
        .insert(schema.campaigns)
        .values({
          orgId: session.orgId,
          name,
          icpDescription: icp,
          status: "running",
          ownerUserId: session.userId,
          startsAt: new Date(r5.data.startsAt),
          hitlState: r5.data.reviewMode === "semi_auto" ? "SEMI_AUTO" : "REVIEW_REQUIRED",
          productDocs,
        })
        .returning({ id: schema.campaigns.id });
      campaignId = ins[0]?.id;
    }

    if (!campaignId) {
      return { ok: false, message: "キャンペーンの作成に失敗しました" };
    }

    await writeAudit({
      orgId: session.orgId,
      actorUserId: session.userId,
      action: "campaign.launched",
      targetType: "campaign",
      targetId: campaignId,
      diff: {
        objective: r1.success ? r1.data.objective : null,
        accounts: r5.data.accountIds.length,
        dailyLimit: r5.data.dailyLimit,
        effectiveDailyLimit: effectiveDaily,
        reviewMode: r5.data.reviewMode,
        startsAt: r5.data.startsAt,
      },
    });

    revalidatePath("/campaigns");
  } catch (e) {
    if (process.env.NODE_ENV !== "production") console.error("[launchCampaign]", e);
    return { ok: false, message: "ローンチ中に問題が発生しました" };
  }

  // redirect は try/catch の外で実行 (NEXT_REDIRECT を握り潰さない)
  redirect(`/campaigns/${campaignId}`);
}
