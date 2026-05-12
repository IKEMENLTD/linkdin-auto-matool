/**
 * Campaign preset seed (4 presets for 営業 SaaS LinkedIn outreach)
 *
 * - Idempotent: 同 orgId × 同 preset の組は skip (existing → no-op)
 * - productDocs.presetId で seed 由来であることを識別
 * - 個別企業に依存しない一般化された preset (機微情報は含めない)
 *
 * 呼び出し例:
 *   const result = await seedCampaignPresets(orgId, ownerUserId);
 *   // → { inserted: ["TM_backoffice", "TM_sales"], skipped: ["TM_ceo", "TM_jinji"] }
 *
 * 参照: db/schema.ts campaigns / server/actions/wizard.ts (insert pattern)
 */

import "server-only";
import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { getDb, schema } from "@/db/client";

/* -------------------------------------------------------------------------- */
/* Preset 定義                                                                */
/* -------------------------------------------------------------------------- */

export const CAMPAIGN_PRESET_IDS = [
  "TM_backoffice",
  "TM_sales",
  "TM_ceo",
  "TM_jinji",
] as const;

export type CampaignPresetId = (typeof CAMPAIGN_PRESET_IDS)[number];

const PresetSchema = z.object({
  presetId: z.enum(CAMPAIGN_PRESET_IDS),
  name: z.string().min(1).max(160),
  icpDescription: z.string().min(1).max(2000),
  keywords: z.array(z.string().min(1)).min(1).max(20),
  recipientTitle: z.string().min(1).max(80),
  dmStyle: z.string().min(1).max(1000),
  headcountHint: z.object({
    min: z.number().int().min(1).max(100000),
    max: z.number().int().min(1).max(100000),
  }),
  recommendedHitl: z.enum(["REVIEW_REQUIRED", "SEMI_AUTO", "FULL_AUTO"]),
});

export type CampaignPreset = z.infer<typeof PresetSchema>;

const PRESETS: ReadonlyArray<CampaignPreset> = [
  {
    presetId: "TM_backoffice",
    name: "バックオフィス責任者",
    icpDescription:
      "従業員 20〜300 名規模の企業で、経理 / 総務 / 給与計算 など管理部門の実務を統括する責任者。" +
      "請求書処理・経費精算・勤怠集計などの定型業務にスプレッドシート / 紙運用が残っており、" +
      "業務効率化の意思決定権を持つか、決裁者に直接提案できる立場の方を対象とする。",
    keywords: [
      "経理責任者",
      "総務責任者",
      "給与計算",
      "バックオフィス",
      "管理部門マネージャー",
      "経理マネージャー",
    ],
    recipientTitle: "バックオフィス責任者",
    dmStyle:
      "相手を現場のエキスパートとして敬意を持って扱う。" +
      "売り込み調を避け『現場の声を伺いたい』というトーンで質問から入る。" +
      "1 メッセージ 160〜200 字、絵文字なし、箇条書きなし、接続リクエストには URL を含めない。",
    headcountHint: { min: 20, max: 300 },
    recommendedHitl: "REVIEW_REQUIRED",
  },
  {
    presetId: "TM_sales",
    name: "営業マネージャー",
    icpDescription:
      "BtoB 企業の営業チーム (5〜50 名規模) を率いる責任者。" +
      "日報・週次レポート・パイプライン集計などのレポーティング工数に課題感を持ち、" +
      "メンバーの稼働を顧客接点に集中させたいと考えている方。SaaS / 人材 / 製造業など業種は問わない。",
    keywords: [
      "営業マネージャー",
      "営業部長",
      "営業責任者",
      "営業企画",
      "セールスマネージャー",
      "インサイドセールス責任者",
    ],
    recipientTitle: "営業責任者",
    dmStyle:
      "数字を見ている立場へのリスペクトを前提に、" +
      "『チームのレポーティング工数』という共通課題に焦点を当てる。" +
      "成果指標 (時間削減・受注率) を匂わせる事例ベースの語り口。煽り・誇張表現は禁止。",
    headcountHint: { min: 30, max: 500 },
    recommendedHitl: "REVIEW_REQUIRED",
  },
  {
    presetId: "TM_ceo",
    name: "中小企業経営者",
    icpDescription:
      "従業員 5〜100 名規模の中小企業の代表取締役 / 役員クラス。" +
      "現場と経営の距離が近く、自社の業務効率や人件費に直接の経営判断を下す方。" +
      "業種は問わないが、定型業務に時間を取られている社員が複数いる事業形態を優先する。",
    keywords: [
      "代表取締役",
      "経営者",
      "CEO",
      "中小企業経営",
      "事業経営",
      "代表",
    ],
    recipientTitle: "経営者",
    dmStyle:
      "経営者の時間は最も希少であることを前提に、初回メッセージは短く (140 字程度)。" +
      "『社員の方が手作業に時間を取られていないか』という経営課題の入り口から会話を開く。" +
      "技術用語を避け、年間コスト / 機会損失で語る。",
    headcountHint: { min: 5, max: 100 },
    recommendedHitl: "REVIEW_REQUIRED",
  },
  {
    presetId: "TM_jinji",
    name: "人事・労務責任者",
    icpDescription:
      "従業員 50〜1000 名規模の企業で、人事 / 労務 / 採用 / 給与 を統括する責任者または CHRO。" +
      "労務手続き・勤怠管理・入退社オペレーション・年末調整など、" +
      "法令対応とオペレーションの両立に課題を持つ方。HR Tech の導入経験は問わない。",
    keywords: [
      "人事責任者",
      "人事マネージャー",
      "人事部長",
      "労務責任者",
      "CHRO",
      "HR マネージャー",
    ],
    recipientTitle: "人事責任者",
    dmStyle:
      "対話型を前提に、初回 DM では URL を送らず質問で会話を始める。" +
      "労務担当の負荷 (年末調整・入退社処理) への共感を起点とし、" +
      "ソリューションよりも先に『現状ヒアリング』を申し出るスタンス。",
    headcountHint: { min: 50, max: 1000 },
    recommendedHitl: "REVIEW_REQUIRED",
  },
] as const;

/* -------------------------------------------------------------------------- */
/* Seed 関数                                                                  */
/* -------------------------------------------------------------------------- */

const UuidSchema = z.string().uuid();

export interface SeedResult {
  inserted: CampaignPresetId[];
  skipped: CampaignPresetId[];
}

/**
 * Idempotent な seed。
 * 既存判定キー: (orgId, productDocs->>'presetId') の一致 OR (orgId, name) の一致。
 */
export async function seedCampaignPresets(
  orgId: string,
  ownerUserId: string
): Promise<SeedResult> {
  const orgIdValid = UuidSchema.safeParse(orgId);
  const ownerIdValid = UuidSchema.safeParse(ownerUserId);
  if (!orgIdValid.success) {
    throw new Error(`seedCampaignPresets: invalid orgId (must be UUID): ${orgId}`);
  }
  if (!ownerIdValid.success) {
    throw new Error(
      `seedCampaignPresets: invalid ownerUserId (must be UUID): ${ownerUserId}`
    );
  }

  for (const p of PRESETS) {
    const r = PresetSchema.safeParse(p);
    if (!r.success) {
      throw new Error(
        `seedCampaignPresets: invalid preset definition '${p.presetId}': ${r.error.message}`
      );
    }
  }

  const db = getDb();
  if (!db) {
    throw new Error(
      "seedCampaignPresets: DATABASE_URL is not configured (getDb() returned null)"
    );
  }

  const presetNames = PRESETS.map((p) => p.name);
  const existing = await db
    .select({
      id: schema.campaigns.id,
      name: schema.campaigns.name,
      productDocs: schema.campaigns.productDocs,
    })
    .from(schema.campaigns)
    .where(
      and(
        eq(schema.campaigns.orgId, orgIdValid.data),
        inArray(schema.campaigns.name, presetNames)
      )
    );

  const existingPresetIds = new Set<CampaignPresetId>();
  for (const row of existing) {
    const docs = (row.productDocs ?? {}) as Record<string, unknown>;
    const pid = typeof docs.presetId === "string" ? docs.presetId : null;
    if (pid && (CAMPAIGN_PRESET_IDS as readonly string[]).includes(pid)) {
      existingPresetIds.add(pid as CampaignPresetId);
      continue;
    }
    const byName = PRESETS.find((p) => p.name === row.name);
    if (byName) existingPresetIds.add(byName.presetId);
  }

  const toInsert = PRESETS.filter((p) => !existingPresetIds.has(p.presetId));

  if (toInsert.length === 0) {
    return {
      inserted: [],
      skipped: PRESETS.map((p) => p.presetId),
    };
  }

  await db.insert(schema.campaigns).values(
    toInsert.map((p) => ({
      orgId: orgIdValid.data,
      name: p.name,
      icpDescription: p.icpDescription,
      status: "draft" as const,
      hitlState: p.recommendedHitl,
      ownerUserId: ownerIdValid.data,
      productDocs: {
        presetId: p.presetId,
        seededAt: new Date().toISOString(),
        keywords: p.keywords,
        recipientTitle: p.recipientTitle,
        dmStyle: p.dmStyle,
        headcountHint: p.headcountHint,
      } satisfies Record<string, unknown>,
    }))
  );

  return {
    inserted: toInsert.map((p) => p.presetId),
    skipped: PRESETS.filter((p) => existingPresetIds.has(p.presetId)).map(
      (p) => p.presetId
    ),
  };
}

/** テスト・スクリプト用に preset 一覧を export (DB に触らない) */
export function listCampaignPresets(): ReadonlyArray<CampaignPreset> {
  return PRESETS;
}
