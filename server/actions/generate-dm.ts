"use server";

import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";

import { getDb, schema } from "@/db/client";
import { getSession, hasAtLeastRole } from "@/lib/auth";
import { writeAudit } from "@/lib/audit";
import { rateLimit } from "@/lib/rate-limit";
import {
  generateDm,
  DmGenerationError,
  type DmGeneratorOutput,
} from "@/lib/ai/dm-generator";
import {
  CampaignPresetIdSchema,
  getCampaignPreset,
} from "@/lib/ai/prompts/campaign-presets";

/* ============================================================
 * Action result shape
 * ============================================================ */

export type GenerateDmResult =
  | {
      ok: true;
      messageId: string;
      content: string;
      model: string;
      tokensUsed: number;
      expectedSurname: string;
      message: string;
    }
  | {
      ok: false;
      reason:
        | "auth_required"
        | "forbidden"
        | "lead_not_found"
        | "campaign_misconfigured"
        | "rate_limited"
        | "guardrail_failed"
        | "api_error"
        | "input_error"
        | "db_unavailable";
      message: string;
      detail?: string;
    };

export const INITIAL_GENERATE_DM_RESULT: GenerateDmResult = {
  ok: false,
  reason: "input_error",
  message: "未実行",
};

/* ============================================================
 * Input schema
 * ============================================================ */

const GenerateDmInputSchema = z.object({
  leadId: z.string().uuid("leadId が UUID ではありません"),
  presetIdOverride: CampaignPresetIdSchema.optional(),
  /** dryRun: true なら DB insert せず生成結果のみ返す (UI のプレビュー用) */
  dryRun: z.coerce.boolean().optional().default(false),
});

async function requireOperator() {
  const session = await getSession();
  if (!session) return { error: "AUTH_REQUIRED" as const, session: null };
  if (!hasAtLeastRole(session.role, "operator")) {
    return { error: "FORBIDDEN" as const, session };
  }
  return { error: null, session };
}

/* ============================================================
 * Main server action
 * ============================================================ */

/**
 * 指定 lead に対して AI で DM2 を生成し、`messages` テーブルに
 * `direction='outbound', aiAssisted=true` で INSERT する。
 *
 * - lead.state は **遷移させない** (実送信は別 action の sendMessage が行う)。
 *   生成 = draft 作成という位置付け。
 * - audit log に model / tokens / surname guardrail 通過を記録。
 * - dryRun=true の場合は生成だけ行って DB insert をスキップ。
 */
export async function generateDmAction(
  _prev: GenerateDmResult | undefined,
  formData: FormData
): Promise<GenerateDmResult> {
  const parsed = GenerateDmInputSchema.safeParse({
    leadId: formData.get("leadId"),
    presetIdOverride: formData.get("presetIdOverride") || undefined,
    dryRun: formData.get("dryRun") ?? false,
  });
  if (!parsed.success) {
    return {
      ok: false,
      reason: "input_error",
      message: parsed.error.issues[0]?.message ?? "入力エラー",
    };
  }
  const { leadId, presetIdOverride, dryRun } = parsed.data;

  const { error, session } = await requireOperator();
  if (error === "AUTH_REQUIRED" || !session) {
    return { ok: false, reason: "auth_required", message: "サインインが必要です" };
  }
  if (error === "FORBIDDEN") {
    return { ok: false, reason: "forbidden", message: "この操作の権限がありません" };
  }

  // org × user 単位で 10 件 / 60 秒
  const rl = rateLimit(`gen-dm:${session.orgId}:${session.userId}`, 10, 60_000);
  if (!rl.ok) {
    return {
      ok: false,
      reason: "rate_limited",
      message:
        "短時間に AI 生成が集中しています。少し時間をおいてから再度お試しください。",
    };
  }

  const db = getDb();
  if (!db) {
    return {
      ok: false,
      reason: "db_unavailable",
      message: "DB に接続できません",
    };
  }

  const rows = await db
    .select({
      lead: {
        id: schema.leads.id,
        orgId: schema.leads.orgId,
        campaignId: schema.leads.campaignId,
        fullName: schema.leads.fullName,
        headline: schema.leads.headline,
        company: schema.leads.company,
        metadata: schema.leads.metadata,
      },
      campaign: {
        id: schema.campaigns.id,
        name: schema.campaigns.name,
        icpDescription: schema.campaigns.icpDescription,
        productDocs: schema.campaigns.productDocs,
      },
    })
    .from(schema.leads)
    .innerJoin(schema.campaigns, eq(schema.campaigns.id, schema.leads.campaignId))
    .where(and(eq(schema.leads.id, leadId), eq(schema.leads.orgId, session.orgId)))
    .limit(1);

  const row = rows[0];
  if (!row) {
    return { ok: false, reason: "lead_not_found", message: "対象のリードが見つかりません" };
  }
  if (!row.lead.fullName) {
    return {
      ok: false,
      reason: "input_error",
      message: "リードに fullName が登録されておらず、DM を生成できません",
    };
  }

  const presetIdFromDocs =
    typeof (row.campaign.productDocs as Record<string, unknown> | null)?.presetId === "string"
      ? ((row.campaign.productDocs as Record<string, unknown>).presetId as string)
      : undefined;
  const presetIdRaw = presetIdOverride ?? presetIdFromDocs;
  const presetIdParsed = CampaignPresetIdSchema.safeParse(presetIdRaw);
  if (!presetIdParsed.success) {
    return {
      ok: false,
      reason: "campaign_misconfigured",
      message:
        "キャンペーン preset が未設定です。campaigns.product_docs.presetId に " +
        "TM_backoffice / TM_sales / TM_ceo / TM_jinji のいずれかを設定してください。",
      detail: `presetIdRaw=${String(presetIdRaw)}`,
    };
  }
  const preset = getCampaignPreset(presetIdParsed.data);

  const leadMeta = (row.lead.metadata ?? {}) as Record<string, unknown>;
  const profileRawText =
    typeof leadMeta.profileRawText === "string" ? (leadMeta.profileRawText as string) : null;

  let generated: DmGeneratorOutput;
  try {
    generated = await generateDm({
      lead: {
        id: row.lead.id,
        fullName: row.lead.fullName,
        headline: row.lead.headline,
        company: row.lead.company,
        profileRawText,
      },
      campaign: {
        id: row.campaign.id,
        name: row.campaign.name,
        icpDescription: row.campaign.icpDescription,
        presetId: preset.id,
      },
      preset,
    });
  } catch (e) {
    if (e instanceof DmGenerationError) {
      const isGuardrail = e.reason !== "api_error" && e.reason !== "invalid_input";
      await writeAudit({
        orgId: session.orgId,
        actorUserId: session.userId,
        action: "message.sent",
        targetType: "lead",
        targetId: row.lead.id,
        diff: {
          kind: "dm_generation_failed",
          presetId: preset.id,
          reason: e.reason,
          detail: e.detail ?? null,
        },
      });
      return {
        ok: false,
        reason: isGuardrail ? "guardrail_failed" : "api_error",
        message: isGuardrail
          ? `品質ガードに引っかかりました (${e.reason})。リトライしてください。`
          : `AI 生成に失敗しました (${e.reason})`,
        detail: e.detail,
      };
    }
    if (process.env.NODE_ENV !== "production") console.error("[generateDmAction]", e);
    return {
      ok: false,
      reason: "api_error",
      message: "AI 生成中に予期しないエラーが発生しました",
    };
  }

  if (dryRun) {
    await writeAudit({
      orgId: session.orgId,
      actorUserId: session.userId,
      action: "message.sent",
      targetType: "lead",
      targetId: row.lead.id,
      diff: {
        kind: "dm_generated_dry_run",
        presetId: preset.id,
        model: generated.model,
        tokensUsed: generated.tokensUsed,
        expectedSurname: generated.expectedSurname,
        length: generated.content.length,
      },
    });
    return {
      ok: true,
      messageId: "dryrun",
      content: generated.content,
      model: generated.model,
      tokensUsed: generated.tokensUsed,
      expectedSurname: generated.expectedSurname,
      message: "(プレビュー) DM を生成しました。送信はされていません。",
    };
  }

  try {
    const messageId = await db.transaction(async (tx) => {
      const [inserted] = await tx
        .insert(schema.messages)
        .values({
          leadId: row.lead.id,
          direction: "outbound",
          content: generated.content,
          aiAssisted: true,
        })
        .returning({ id: schema.messages.id });

      await tx
        .update(schema.leads)
        .set({ lastActionAt: new Date() })
        .where(eq(schema.leads.id, row.lead.id));

      await writeAudit(
        {
          orgId: session.orgId,
          actorUserId: session.userId,
          action: "message.sent",
          targetType: "lead",
          targetId: row.lead.id,
          diff: {
            kind: "dm_generated",
            messageId: inserted.id,
            presetId: preset.id,
            model: generated.model,
            tokens: generated.tokens,
            tokensUsed: generated.tokensUsed,
            expectedSurname: generated.expectedSurname,
            surnameGuardrailPassed: generated.surnameGuardrailPassed,
            length: generated.content.length,
          },
        },
        tx
      );

      return inserted.id;
    });

    revalidatePath(`/inbox/${row.lead.id}`);
    revalidatePath("/inbox");

    return {
      ok: true,
      messageId,
      content: generated.content,
      model: generated.model,
      tokensUsed: generated.tokensUsed,
      expectedSurname: generated.expectedSurname,
      message: "AI で DM を生成しました。送信前に内容を確認してください。",
    };
  } catch (e) {
    if (process.env.NODE_ENV !== "production") console.error("[generateDmAction:tx]", e);
    return {
      ok: false,
      reason: "db_unavailable",
      message: "生成結果の保存中に問題が発生しました",
    };
  }
}
