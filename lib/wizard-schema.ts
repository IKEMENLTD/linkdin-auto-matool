import { z } from "zod";

export const OBJECTIVES = ["outbound", "event", "hiring", "research"] as const;
export type Objective = (typeof OBJECTIVES)[number];

export const OBJECTIVE_META: Record<
  Objective,
  { ja: string; desc: string; emoji?: string }
> = {
  outbound: { ja: "新規開拓", desc: "Outbound 営業 / リード獲得" },
  event: { ja: "イベント招待", desc: "展示会・ウェビナーへの誘導" },
  hiring: { ja: "採用スカウト", desc: "HR / RPO 向けの候補者開拓" },
  research: { ja: "リサーチ", desc: "市場調査・ヒアリング" },
};

export const TONES = ["formal", "casual", "friendly"] as const;
export type Tone = (typeof TONES)[number];
export const TONE_META: Record<Tone, { ja: string; desc: string }> = {
  formal: { ja: "フォーマル", desc: "敬体を主体に、丁寧に" },
  casual: { ja: "ややカジュアル", desc: "親しみと礼節のバランス" },
  friendly: { ja: "親しみ重視", desc: "距離を縮める語り口" },
};

export const LENGTHS = ["short", "medium", "long"] as const;
export type Length = (typeof LENGTHS)[number];

export const REVIEW_MODES = ["review_required", "semi_auto"] as const;
export type ReviewMode = (typeof REVIEW_MODES)[number];

export const Step1Schema = z.object({
  objective: z.enum(OBJECTIVES, { errorMap: () => ({ message: "目的を選択してください" }) }),
});
export type Step1 = z.infer<typeof Step1Schema>;

export const Step2Schema = z.object({
  productUrl: z
    .string()
    .trim()
    .url("製品 URL は https:// で始まる正しい URL を入力してください")
    .max(2048)
    .optional()
    .or(z.literal("")),
  companyName: z.string().trim().min(1, "会社名を入力してください").max(120),
  productSummary: z
    .string()
    .trim()
    .min(20, "製品概要を 20 文字以上で入力してください")
    .max(400, "製品概要は 400 文字以内に収めてください"),
  strengths: z
    .array(z.string().trim().max(60))
    .max(5)
    .default([]),
});
export type Step2 = z.infer<typeof Step2Schema>;

export const REGIONS = ["jp", "global", "us", "eu"] as const;
export type Region = (typeof REGIONS)[number];

export const FUNDING_STAGES = ["seed", "a", "b", "c", "ipo"] as const;
export type FundingStage = (typeof FUNDING_STAGES)[number];

export const Step3Schema = z
  .object({
    jobTitles: z
      .array(z.string().trim().max(80))
      .min(1, "ターゲット役職を 1 つ以上指定してください")
      .max(20),
    industries: z.array(z.string().trim().max(80)).max(20).default([]),
    headcountMin: z.number().int().min(0).max(1_000_000).default(10),
    headcountMax: z.number().int().min(0).max(1_000_000).default(10000),
    regions: z.array(z.enum(REGIONS)).default(["jp"]),
    funding: z.array(z.enum(FUNDING_STAGES)).default([]),
    customQuery: z.string().trim().max(1024).optional().or(z.literal("")),
  })
  .superRefine((value, ctx) => {
    if (value.headcountMin > value.headcountMax) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["headcountMax"],
        message: "従業員規模の最大は最小以上の値を選んでください",
      });
    }
  });
export type Step3 = z.infer<typeof Step3Schema>;

export const Step4Schema = z
  .object({
    tone: z.enum(TONES).default("formal"),
    length: z.enum(LENGTHS).default("medium"),
    connectMessage: z
      .string()
      .trim()
      .max(300, "コネクト申請は 300 文字以内に収めてください")
      .default(""),
    firstDm: z
      .string()
      .trim()
      .min(40, "初回 DM を 40 文字以上で書いてください")
      .max(1500),
    abEnabled: z.boolean().default(false),
    abVariantB: z.string().trim().max(1500).optional().or(z.literal("")),
  })
  .superRefine((value, ctx) => {
    // テンプレ変数 {{ }} の残存をチェック (送信不可)
    const hasUnfilled = /\{\{\s*[a-zA-Z_]+\s*\}\}/.test(value.firstDm);
    if (hasUnfilled) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["firstDm"],
        message: "テンプレート変数 {{ }} が残っています。差し込みするか削除してください",
      });
    }
    if (value.abEnabled && (!value.abVariantB || value.abVariantB.trim().length < 40)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["abVariantB"],
        message: "A/B テスト案 B も 40 文字以上で記入してください",
      });
    }
  });
export type Step4 = z.infer<typeof Step4Schema>;

export const Step5Schema = z
  .object({
    accountIds: z
      .array(z.string().uuid())
      .min(1, "担当アカウントを 1 つ以上選択してください")
      .max(20),
    dailyLimit: z
      .number()
      .int()
      .min(1, "日次上限は 1 件以上必要です")
      .max(200, "日次上限は 200 件までです"),
    startTime: z.string().regex(/^\d{2}:\d{2}$/, "HH:mm 形式で入力してください"),
    endTime: z.string().regex(/^\d{2}:\d{2}$/, "HH:mm 形式で入力してください"),
    weekdaysOnly: z.boolean().default(true),
    reviewMode: z.enum(REVIEW_MODES).default("review_required"),
    startsAt: z.string().min(1, "開始日を選択してください"),
    consentPolicy: z
      .boolean()
      .refine((v) => v === true, { message: "利用規約への同意が必要です" }),
  })
  .superRefine((value, ctx) => {
    if (value.startTime >= value.endTime) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["endTime"],
        message: "終了時刻は開始時刻より後を選んでください",
      });
    }
  });
export type Step5 = z.infer<typeof Step5Schema>;

export const WizardSchema = z.object({
  step1: Step1Schema.optional(),
  step2: Step2Schema.optional(),
  step3: Step3Schema.optional(),
  step4: Step4Schema.optional(),
  step5: Step5Schema.optional(),
});
export type WizardState = z.infer<typeof WizardSchema>;

export const STEPS = [
  { id: 1, key: "objective", label: "目的" },
  { id: 2, key: "product", label: "商品 / 会社" },
  { id: 3, key: "icp", label: "ICP 定義" },
  { id: 4, key: "message", label: "メッセージ" },
  { id: 5, key: "delivery", label: "配信設定" },
] as const;
export type StepId = (typeof STEPS)[number]["id"];

/** ヒット推定: ICP の各フィールドから疑似的に件数を返す (Phase2 で Unipile API に置換) */
export function estimateReach(step3?: Step3): number {
  if (!step3) return 0;
  const base = 18000;
  const jobFactor = Math.max(0.05, Math.min(1, (step3.jobTitles?.length ?? 0) * 0.15));
  const industryFactor = step3.industries.length === 0 ? 1 : Math.min(1, step3.industries.length * 0.18);
  const headcountSpan = Math.max(10, step3.headcountMax - step3.headcountMin);
  const headcountFactor = Math.min(1, headcountSpan / 5000);
  const regionFactor = step3.regions.includes("global") ? 1.4 : 0.45;
  const fundingFactor = step3.funding.length === 0 ? 1 : Math.min(1, step3.funding.length * 0.22);
  const customFactor = step3.customQuery && step3.customQuery.trim().length > 0 ? 0.6 : 1;
  return Math.round(
    base * jobFactor * industryFactor * headcountFactor * regionFactor * fundingFactor * customFactor
  );
}

/** ウォームアップ段階の安全上限 (デモ用) */
export const WARMUP_DAILY_CAP_BY_DAY = (day: number): number => {
  if (day <= 4) return 8;
  if (day <= 9) return 17;
  return 25;
};
