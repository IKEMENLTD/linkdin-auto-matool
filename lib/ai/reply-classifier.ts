import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { REPLY_CLASSIFIER_SYSTEM_PROMPT } from "./prompts/reply-classifier-system";

/* ============================================================
 * 公開型 (Zod + TS)
 * ============================================================ */

export const ReplyClassificationEnum = z.enum([
  "positive",
  "negative",
  "question",
  "neutral",
  "spam",
]);
export type ReplyClassification = z.infer<typeof ReplyClassificationEnum>;

export const SuggestedActionEnum = z.enum([
  "send_calendar_link",
  "human_review",
  "pause_campaign",
  "no_action",
]);
export type SuggestedAction = z.infer<typeof SuggestedActionEnum>;

export const ClassifyReplyInputSchema = z.object({
  messageContent: z
    .string()
    .trim()
    .min(1, "messageContent is empty")
    .max(4000, "messageContent exceeds 4000 chars"),
  leadContext: z
    .object({
      name: z.string().trim().max(160).optional(),
      company: z.string().trim().max(160).optional(),
      lastOutboundContent: z.string().trim().max(2000).optional(),
    })
    .default({}),
});
export type ClassifyReplyInput = z.infer<typeof ClassifyReplyInputSchema>;

export const ClassifyReplyOutputSchema = z.object({
  classification: ReplyClassificationEnum,
  confidence: z.number().min(0).max(1),
  reasoning: z.string().min(1).max(400),
  suggestedAction: SuggestedActionEnum,
  model: z.string(),
  latencyMs: z.number().int().nonnegative(),
  classifiedAt: z.string(),
});
export type ClassifyReplyOutput = z.infer<typeof ClassifyReplyOutputSchema>;

/* ============================================================
 * Anthropic クライアント (lazy / singleton)
 * ============================================================ */

let _client: Anthropic | null = null;
function getClient(): Anthropic {
  if (_client) return _client;
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY is not set");
  _client = new Anthropic({ apiKey, maxRetries: 1 });
  return _client;
}

/* ============================================================
 * 定数
 * ============================================================ */

const MODEL = "claude-haiku-4-5-20251001"; // コスト最適。Sonnet の 1/5 程度。
const MAX_TOKENS = 400;
const TIMEOUT_MS = 2800; // 3 秒以内目標

/** Claude tool_use の JSONSchema。出力構造を強制する。 */
const CLASSIFY_TOOL = {
  name: "classify_reply",
  description:
    "LinkedIn 返信メッセージを 5 カテゴリに分類し、推奨アクションを返す。必ずこの 1 ツールを 1 回だけ呼び出すこと。",
  input_schema: {
    type: "object" as const,
    properties: {
      classification: {
        type: "string",
        enum: ["positive", "negative", "question", "neutral", "spam"],
        description: "分類カテゴリ。婉曲拒否は negative。pending は neutral に含める。",
      },
      confidence: {
        type: "number",
        minimum: 0,
        maximum: 1,
        description: "0.0-1.0 の確信度。曖昧なら 0.6-0.8、明確なら 0.9+。",
      },
      reasoning: {
        type: "string",
        minLength: 1,
        maxLength: 400,
        description: "日本語 60 文字以内の判定根拠。",
      },
      suggestedAction: {
        type: "string",
        enum: ["send_calendar_link", "human_review", "pause_campaign", "no_action"],
        description:
          "positive→send_calendar_link, negative/spam→pause_campaign, question/neutral→human_review。",
      },
    },
    required: ["classification", "confidence", "reasoning", "suggestedAction"],
    additionalProperties: false,
  },
} as const;

/* ============================================================
 * 公開 API
 * ============================================================ */

export class ReplyClassifierError extends Error {
  constructor(
    message: string,
    readonly code:
      | "INVALID_INPUT"
      | "API_ERROR"
      | "TIMEOUT"
      | "INVALID_OUTPUT"
      | "MISSING_TOOL_USE",
    readonly cause?: unknown
  ) {
    super(message);
    this.name = "ReplyClassifierError";
  }
}

/**
 * LinkedIn 返信を分類する。
 *
 * - Claude Haiku 4.5 + tool_use で構造化出力を強制 (JSON パース失敗ゼロ)
 * - 3 秒タイムアウト (AbortController)
 * - 失敗時は throw → 呼び出し側で human_review にフォールバック推奨
 */
export async function classifyReply(
  rawInput: ClassifyReplyInput
): Promise<ClassifyReplyOutput> {
  const inputParsed = ClassifyReplyInputSchema.safeParse(rawInput);
  if (!inputParsed.success) {
    throw new ReplyClassifierError(
      inputParsed.error.issues.map((i) => i.message).join("; "),
      "INVALID_INPUT",
      inputParsed.error
    );
  }
  const input = inputParsed.data;

  const contextLines: string[] = [];
  if (input.leadContext.name) contextLines.push(`相手氏名: ${input.leadContext.name}`);
  if (input.leadContext.company) contextLines.push(`相手会社: ${input.leadContext.company}`);
  if (input.leadContext.lastOutboundContent) {
    contextLines.push(
      `直前にこちらから送ったメッセージ:\n"""\n${input.leadContext.lastOutboundContent}\n"""`
    );
  }
  const contextBlock = contextLines.length
    ? `# 文脈\n${contextLines.join("\n")}\n\n`
    : "";

  const userContent =
    `${contextBlock}# 分類対象の返信メッセージ\n"""\n${input.messageContent}\n"""\n\n` +
    `上記を classify_reply ツールで分類してください。`;

  const startedAt = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  let response: Anthropic.Messages.Message;
  try {
    response = await getClient().messages.create(
      {
        model: MODEL,
        max_tokens: MAX_TOKENS,
        system: REPLY_CLASSIFIER_SYSTEM_PROMPT,
        tools: [CLASSIFY_TOOL],
        tool_choice: { type: "tool", name: "classify_reply" },
        messages: [{ role: "user", content: userContent }],
      },
      { signal: controller.signal }
    );
  } catch (e) {
    if (controller.signal.aborted) {
      throw new ReplyClassifierError(
        `Classification timed out after ${TIMEOUT_MS}ms`,
        "TIMEOUT",
        e
      );
    }
    throw new ReplyClassifierError(
      e instanceof Error ? e.message : "Anthropic API error",
      "API_ERROR",
      e
    );
  } finally {
    clearTimeout(timer);
  }

  const toolUse = response.content.find(
    (c): c is Extract<Anthropic.Messages.ContentBlock, { type: "tool_use" }> =>
      c.type === "tool_use" && c.name === "classify_reply"
  );
  if (!toolUse) {
    throw new ReplyClassifierError(
      "Model did not call classify_reply tool",
      "MISSING_TOOL_USE",
      response
    );
  }

  const RawSchema = z.object({
    classification: ReplyClassificationEnum,
    confidence: z.number().min(0).max(1),
    reasoning: z.string().min(1).max(400),
    suggestedAction: SuggestedActionEnum,
  });
  const outParsed = RawSchema.safeParse(toolUse.input);
  if (!outParsed.success) {
    throw new ReplyClassifierError(
      `Invalid tool output: ${outParsed.error.message}`,
      "INVALID_OUTPUT",
      outParsed.error
    );
  }

  return {
    ...outParsed.data,
    model: MODEL,
    latencyMs: Date.now() - startedAt,
    classifiedAt: new Date().toISOString(),
  };
}

/**
 * 失敗時に安全側に倒したフォールバック値を返すラッパ。
 * オペレーターレビュー必須の neutral にする。
 */
export async function classifyReplySafe(
  rawInput: ClassifyReplyInput
): Promise<ClassifyReplyOutput> {
  try {
    return await classifyReply(rawInput);
  } catch (e) {
    if (process.env.NODE_ENV !== "production") {
      console.error("[classifyReplySafe] fallback to neutral:", e);
    }
    return {
      classification: "neutral",
      confidence: 0,
      reasoning:
        e instanceof ReplyClassifierError
          ? `分類失敗 (${e.code})。人間レビュー必須。`
          : "分類失敗。人間レビュー必須。",
      suggestedAction: "human_review",
      model: MODEL,
      latencyMs: 0,
      classifiedAt: new Date().toISOString(),
    };
  }
}
