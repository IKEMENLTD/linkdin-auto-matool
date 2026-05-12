import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { SYSTEM_PROMPT_BASE } from "./prompts/dm2-system";
import type { CampaignPreset } from "./prompts/campaign-presets";

/* ============================================================
 * 型定義 / Zod スキーマ
 * ============================================================ */

/** 生成入力に最低限必要なリード情報 (DB 行をそのまま渡せる shape) */
export const DmGeneratorLeadSchema = z.object({
  id: z.string().uuid(),
  fullName: z.string().min(1, "fullName required for DM generation"),
  headline: z.string().nullable().optional(),
  company: z.string().nullable().optional(),
  /** Unipile 由来のプロフィール本文 (なくても可、あれば品質向上) */
  profileRawText: z.string().nullable().optional(),
});
export type DmGeneratorLead = z.infer<typeof DmGeneratorLeadSchema>;

/** 生成入力のキャンペーン情報 */
export const DmGeneratorCampaignSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  /** ICP (理想顧客像) の自然言語記述。preset の icpDescription を上書き可 */
  icpDescription: z.string().nullable().optional(),
  /** preset 識別子 (TM_backoffice / TM_sales / TM_ceo / TM_jinji) */
  presetId: z.string().optional(),
});
export type DmGeneratorCampaign = z.infer<typeof DmGeneratorCampaignSchema>;

export const DmGeneratorInputSchema = z.object({
  lead: DmGeneratorLeadSchema,
  campaign: DmGeneratorCampaignSchema,
  /** キャンペーン preset (差出人名・業種・productDocs 等) */
  preset: z.custom<CampaignPreset>((v) => !!v && typeof v === "object", "preset required"),
  /** few-shot 例の override。未指定なら preset / system prompt の組込み例を使用 */
  fewShotExamples: z.array(z.string()).optional(),
});
export type DmGeneratorInput = z.infer<typeof DmGeneratorInputSchema>;

export interface DmGeneratorOutput {
  /** 生成された DM 本文 (日程調整 URL 付与 + 改行整形済み) */
  content: string;
  /** 使用したモデル ID */
  model: string;
  /** input + output トークン合計 */
  tokensUsed: number;
  /** input/output 内訳 (audit 用) */
  tokens: { input: number; output: number; cacheRead: number; cacheCreation: number };
  /** 姓ガードレールを通過したか (false の場合は throw 済みのため到達しない) */
  surnameGuardrailPassed: boolean;
  /** 期待した姓 (audit 用) */
  expectedSurname: string;
}

/** 既知の失敗カテゴリ。呼び出し側でリトライ可否を判断できるよう class で区別する */
export class DmGenerationError extends Error {
  constructor(public readonly reason: DmFailReason, public readonly detail?: string) {
    super(`[DmGenerationError] ${reason}${detail ? `: ${detail}` : ""}`);
    this.name = "DmGenerationError";
  }
}

export type DmFailReason =
  | "empty"
  | "too_short"
  | "too_long"
  | "contains_url_in_generation"
  | "ng_word"
  | "price_mentioned"
  | "ng_phrase"
  | "missing_sender"
  | "wrong_salutation"
  | "missing_number"
  | "signature_with_affiliation"
  | "api_error"
  | "invalid_input";

/* ============================================================
 * 定数
 * ============================================================ */

/** DM 末尾に付与する日程調整リンク (env から取得、未設定なら付与しない) */
function getSchedulingUrl(): string | null {
  return process.env.SCHEDULING_BOOKING_URL ?? null;
}

/** Anthropic 推奨「personalized content at scale」用モデル */
export const DM_GENERATOR_MODEL = "claude-sonnet-4-6";

/** Claude API max_tokens (DM2 は 200-350 字目安) */
const MAX_OUTPUT_TOKENS = 500;

/** 語彙 NG リスト */
const NG_WORDS = [
  "シナジー",
  "ROI",
  "パラダイム",
  "ソリューション",
  "イノベーション",
  "ディスラプト",
  "アジャイル",
  "グロースハック",
] as const;

/** 価格関連 NG パターン */
const PRICE_NG_PATTERNS: readonly RegExp[] = [
  /月額\s*\d+/u,
  /\d+\s*円から/u,
  /\d+\s*万円/u,
  /価格は/u,
  /料金は/u,
];

/** 空挨拶 / yes-no 質問 NG */
const NG_PHRASES = [
  "ご活躍",
  "ご多忙",
  "益々",
  "皆様",
  "興味ありますか",
  "されていますか",
  "いかがですか",
] as const;

/** 署名行に混入してはいけない所属表現 */
const AFFILIATION_NG = ["株式会社", "代表取締役", "CEO", "/ 所属"] as const;

/* ============================================================
 * 公開 API: generateDm
 * ============================================================ */

/**
 * 1 リードに対して接続承認後 DM (DM2) を生成する。
 *
 * - System prompt は ephemeral cache (prompt caching) でキャンペーン横断で再利用
 * - 出力に対して 7 項目のガードレール (姓 / 数値 / NG 語彙 / 価格 / URL / 文字数 / 署名)
 * - 違反時は `DmGenerationError` を throw する。リトライは呼び出し側で。
 */
export async function generateDm(rawInput: DmGeneratorInput): Promise<DmGeneratorOutput> {
  const parsed = DmGeneratorInputSchema.safeParse(rawInput);
  if (!parsed.success) {
    throw new DmGenerationError("invalid_input", parsed.error.issues[0]?.message ?? "schema");
  }
  const { lead, campaign, preset, fewShotExamples } = parsed.data;

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new DmGenerationError("api_error", "ANTHROPIC_API_KEY not set");
  }

  const expectedSurname = extractFamilyName(lead.fullName);
  if (!expectedSurname) {
    throw new DmGenerationError("invalid_input", "could not derive surname from fullName");
  }

  const client = new Anthropic({ apiKey });

  const systemBlocks = buildSystemBlocks({
    senderName: preset.senderName,
    presetId: preset.id,
    recipientTitle: preset.recipientTitle,
    keywords: preset.keywords.slice(0, 3).join(", "),
    icpDescription: campaign.icpDescription ?? preset.icpDescription,
    productDocs: preset.productDocs,
    fewShotExamples,
  });

  const userMessage = buildUserMessage({
    lead,
    expectedSurname,
  });

  let response: Anthropic.Messages.Message;
  try {
    response = await client.messages.create({
      model: DM_GENERATOR_MODEL,
      max_tokens: MAX_OUTPUT_TOKENS,
      system: systemBlocks,
      messages: [{ role: "user", content: userMessage }],
    });
  } catch (e) {
    throw new DmGenerationError(
      "api_error",
      e instanceof Error ? e.message : "unknown anthropic error"
    );
  }

  const raw = response.content
    .filter((b): b is Anthropic.Messages.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("")
    .trim();

  const humanized = humanizeDmFormatting(raw, preset.senderName);

  runGuardrails(humanized, {
    expectedSurname,
    senderName: preset.senderName,
  });

  const finalContent = appendSchedulingLink(humanized);

  const usage = response.usage;
  return {
    content: finalContent,
    model: response.model,
    tokensUsed: usage.input_tokens + usage.output_tokens,
    tokens: {
      input: usage.input_tokens,
      output: usage.output_tokens,
      cacheRead: usage.cache_read_input_tokens ?? 0,
      cacheCreation: usage.cache_creation_input_tokens ?? 0,
    },
    surnameGuardrailPassed: true,
    expectedSurname,
  };
}

/* ============================================================
 * System / User prompt 構築
 * ============================================================ */

function buildSystemBlocks(args: {
  senderName: string;
  presetId: string;
  recipientTitle: string;
  keywords: string;
  icpDescription?: string | null;
  productDocs?: string | null;
  fewShotExamples?: string[];
}): Anthropic.Messages.TextBlockParam[] {
  const blocks: Anthropic.Messages.TextBlockParam[] = [
    {
      // === 共通ベース (cache 対象) ===
      type: "text",
      text: SYSTEM_PROMPT_BASE,
      cache_control: { type: "ephemeral" },
    },
  ];

  const contextParts: string[] = [
    `# このDMの文脈`,
    `送信者: ${args.senderName}`,
    `キャンペーン: ${args.presetId}`,
    `想定読者: ${args.recipientTitle}`,
    `業種キーワード: ${args.keywords}`,
    "",
    `末尾署名は「${args.senderName}」のみ（所属は書かない）。`,
  ];
  if (args.icpDescription) {
    contextParts.push("", `# ICP (理想顧客像)`, args.icpDescription);
  }
  if (args.productDocs) {
    contextParts.push("", `# プロダクト情報 (自己紹介ビートで参照)`, args.productDocs);
  }
  blocks.push({ type: "text", text: contextParts.join("\n") });

  if (args.fewShotExamples && args.fewShotExamples.length > 0) {
    blocks.push({
      type: "text",
      text:
        "# 追加 Few-shot 例 (このトーン・粒度を必ず超える)\n\n" +
        args.fewShotExamples.map((ex, i) => `## 追加例 ${i + 1}\n\n${ex}`).join("\n\n"),
    });
  }

  return blocks;
}

function buildUserMessage(args: { lead: DmGeneratorLead; expectedSurname: string }): string {
  const { lead, expectedSurname } = args;
  const profile = (lead.profileRawText ?? "").slice(0, 1500);

  return [
    `【相手の情報】`,
    `名前: ${lead.fullName}`,
    `宛名: ${expectedSurname}様  ← DM冒頭は必ずこの宛名を使用 (他の名前は絶対に使わない)`,
    `役職: ${lead.headline ?? ""}`,
    `会社: ${lead.company ?? ""}`,
    ``,
    `【LinkedInプロフィール本文（抜粋）】`,
    profile,
    ``,
    `上記プロフィールから、${lead.fullName}さん固有の取り組み・事業・ミッションを1つ抽出し、`,
    `承認後DMを4ビート構造（共感→Why you→Why now→soft CTA）で生成してください。`,
    `200-350文字、丁寧語、署名込み。`,
    ``,
    `【重要】DM冒頭は「${expectedSurname}様」で必ず始めてください。他の名前を使わないこと。`,
  ].join("\n");
}

/* ============================================================
 * 姓抽出 (姓ガードレールの基準値)
 * ============================================================ */

/**
 * 表示名から姓を抽出する。
 *  - NFC 正規化 → 全角空白 → 半角空白
 *  - 日本語 (ひらがな・カタカナ・CJK 統合漢字) が含まれていれば先頭トークン = 姓
 *  - そうでなければ末尾トークン = 姓 (英語名規則)
 */
export function extractFamilyName(name: string | null | undefined): string {
  if (!name) return "";
  const norm = name.normalize("NFC").replace(/　/g, " ").trim();
  const parts = norm.split(/\s+/).filter((p) => p.length > 0);
  if (parts.length === 0) return norm;

  const isJapanese = /[぀-ヿ一-鿿]/u.test(norm);
  return isJapanese ? parts[0] : parts[parts.length - 1];
}

/* ============================================================
 * フォーマット整形 (humanizeDmFormatting)
 * ============================================================ */

const META_PATTERNS: readonly RegExp[] = [
  /^以下.*(?:DM|メッセージ|です|になります)[:：]?\s*$/u,
  /^こちらが.*です[:：。]?\s*$/u,
  /^---+\s*$/u,
  /^\s*\*\*注[:：].*\*\*\s*$/u,
  /^\s*https?:\/\/\S+\s*$/u,
  /^```[a-zA-Z]*\s*$/u,
  /^```\s*$/u,
];

/**
 * Claude 出力を人間的なリズムに軽く整形する安全網。
 */
export function humanizeDmFormatting(text: string, senderName: string): string {
  if (!text) return text;

  const fence = text.match(/```(?:[a-zA-Z]*)?\s*\n([\s\S]*?)\n```/u);
  let work = fence ? fence[1] : text;

  work = work
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(/　/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .trim();

  const filteredLines = work
    .split("\n")
    .filter((line) => !META_PATTERNS.some((p) => p.test(line.trim())));
  work = filteredLines.join("\n");

  work = work.replace(/\n{3,}/g, "\n\n");

  const rescuedLines: string[] = [];
  for (const line of work.split("\n")) {
    if (line.length > 100 && !line.includes("\n")) {
      const sentences = line.match(/[^。]*。|[^。]+$/gu) ?? [line];
      for (const s of sentences) {
        const trimmed = s.trim();
        if (trimmed) rescuedLines.push(trimmed);
      }
    } else {
      rescuedLines.push(line);
    }
  }
  work = rescuedLines.join("\n");

  const lines = work.split("\n");
  const result: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const next = i + 1 < lines.length ? lines[i + 1] : null;
    result.push(line);
    if (!line || next === null || next === "") continue;

    const trimmed = line.trim();
    if (/^.{1,10}様$/u.test(trimmed)) {
      result.push("");
      continue;
    }
    if (trimmed.includes("突然のご連絡") && trimmed.includes("失礼いたします")) {
      result.push("");
      continue;
    }
    if (trimmed.endsWith("と申します。")) {
      result.push("");
      continue;
    }
    if ((trimmed.includes("嬉しいです") || trimmed.includes("幸いです")) && trimmed.endsWith("。")) {
      if (next.trim() === senderName) {
        result.push("");
      }
    }
  }
  return result.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

/* ============================================================
 * スケジューリングリンク付与
 * ============================================================ */

export function appendSchedulingLink(text: string): string {
  if (!text) return text;
  const url = getSchedulingUrl();
  if (!url) return text;
  if (text.includes(url)) return text;
  return `${text.replace(/\s+$/u, "")}\n\n${url}`;
}

/* ============================================================
 * ガードレール
 * ============================================================ */

function runGuardrails(
  text: string,
  ctx: { expectedSurname: string; senderName: string }
): void {
  if (!text) throw new DmGenerationError("empty");
  if (text.length < 150) throw new DmGenerationError("too_short", String(text.length));
  if (text.length > 450) throw new DmGenerationError("too_long", String(text.length));

  if (text.includes("http://") || text.includes("https://")) {
    throw new DmGenerationError("contains_url_in_generation");
  }

  for (const ng of NG_WORDS) {
    if (text.includes(ng)) throw new DmGenerationError("ng_word", ng);
  }

  for (const pat of PRICE_NG_PATTERNS) {
    if (pat.test(text)) throw new DmGenerationError("price_mentioned", pat.source);
  }

  for (const phrase of NG_PHRASES) {
    if (text.includes(phrase)) throw new DmGenerationError("ng_phrase", phrase);
  }

  if (ctx.senderName && !text.includes(ctx.senderName)) {
    throw new DmGenerationError("missing_sender", ctx.senderName);
  }

  // 姓ガードレール: 宛名 (姓) が DM 冒頭 100 文字以内に含まれるか
  if (ctx.expectedSurname.length >= 2) {
    const head = text.slice(0, 100);
    if (!head.includes(`${ctx.expectedSurname}様`) && !head.includes(`${ctx.expectedSurname}さん`)) {
      throw new DmGenerationError(
        "wrong_salutation",
        `expected '${ctx.expectedSurname}様' in head='${head.slice(0, 50)}...'`
      );
    }
  }

  if (!/\d+[円件時間社名年月分%％]/u.test(text)) {
    throw new DmGenerationError("missing_number");
  }

  const tail = text.trim().split("\n").slice(-3).join("\n");
  for (const w of AFFILIATION_NG) {
    if (tail.includes(w)) {
      throw new DmGenerationError("signature_with_affiliation", w);
    }
  }
}
