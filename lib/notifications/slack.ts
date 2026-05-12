import "server-only";
import { z } from "zod";

/**
 * Slack incoming webhook ラッパー (設計書 §24 監視 / §12 安全層連動)。
 *
 *   - env `SLACK_WEBHOOK_URL` から URL を取得
 *   - Block Kit 形式の構造化メッセージ
 *   - タイムアウト / リトライ / fail-soft (呼び出し側に boolean を返却)
 */

export interface SlackAlertField {
  readonly label: string;
  readonly value: string;
}

export interface SlackAlertPayload {
  readonly title: string;
  readonly incidentId: string;
  readonly orgId: string;
  readonly severity: "critical" | "warning" | "info";
  readonly fields: readonly SlackAlertField[];
  readonly contextMarkdown?: string;
}

export type SlackSendResult =
  | { readonly ok: true; readonly status: number }
  | { readonly ok: false; readonly error: string; readonly status?: number };

const payloadSchema = z.object({
  title: z.string().min(1).max(256),
  incidentId: z.string().min(1).max(64),
  orgId: z.string().min(1).max(64),
  severity: z.enum(["critical", "warning", "info"]),
  fields: z
    .array(
      z.object({
        label: z.string().min(1).max(64),
        value: z.string().min(1).max(512),
      })
    )
    .max(20),
  contextMarkdown: z.string().max(1024).optional(),
});

const channelSchema = z
  .string()
  .regex(/^#[a-z0-9\-_]{1,80}$/, "invalid slack channel");

const SLACK_TIMEOUT_MS = 5_000;
const SLACK_MAX_ATTEMPTS = 2;

const SEVERITY_EMOJI: Record<SlackAlertPayload["severity"], string> = {
  critical: ":rotating_light:",
  warning: ":warning:",
  info: ":information_source:",
};

function buildBlocks(payload: SlackAlertPayload): unknown[] {
  const emoji = SEVERITY_EMOJI[payload.severity];

  const fieldBlocks = payload.fields.map((f) => ({
    type: "mrkdwn",
    text: `*${f.label}*\n\`${f.value}\``,
  }));

  const chunked: unknown[][] = [];
  for (let i = 0; i < fieldBlocks.length; i += 10) {
    chunked.push(fieldBlocks.slice(i, i + 10));
  }

  const blocks: unknown[] = [
    {
      type: "header",
      text: { type: "plain_text", text: `${emoji} ${payload.title}`, emoji: true },
    },
    {
      type: "section",
      fields: [
        { type: "mrkdwn", text: `*Incident*\n\`${payload.incidentId}\`` },
        { type: "mrkdwn", text: `*Org*\n\`${payload.orgId}\`` },
        { type: "mrkdwn", text: `*Severity*\n\`${payload.severity}\`` },
      ],
    },
    ...chunked.map((fields) => ({ type: "section", fields })),
  ];

  if (payload.contextMarkdown) {
    blocks.push({
      type: "context",
      elements: [{ type: "mrkdwn", text: payload.contextMarkdown }],
    });
  }

  return blocks;
}

/**
 * Slack incoming webhook に構造化アラートを送信する。
 * 失敗時は throw せず `{ ok: false, error }` を返す (fail-soft)。
 */
export async function sendSlackAlert(
  channel: string,
  payload: SlackAlertPayload
): Promise<SlackSendResult> {
  const webhookUrl = process.env.SLACK_WEBHOOK_URL;
  if (!webhookUrl) {
    return { ok: false, error: "SLACK_WEBHOOK_URL is not configured" };
  }

  const channelParse = channelSchema.safeParse(channel);
  if (!channelParse.success) {
    return { ok: false, error: `invalid channel: ${channelParse.error.message}` };
  }

  const payloadParse = payloadSchema.safeParse(payload);
  if (!payloadParse.success) {
    return { ok: false, error: `invalid payload: ${payloadParse.error.message}` };
  }

  const body = JSON.stringify({
    channel: channelParse.data,
    text: `${payloadParse.data.title} (${payloadParse.data.incidentId})`,
    blocks: buildBlocks(payloadParse.data),
  });

  let lastError = "unknown";
  let lastStatus: number | undefined;

  for (let attempt = 1; attempt <= SLACK_MAX_ATTEMPTS; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), SLACK_TIMEOUT_MS);
    try {
      const res = await fetch(webhookUrl, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body,
        signal: controller.signal,
      });
      lastStatus = res.status;
      if (res.ok) {
        return { ok: true, status: res.status };
      }
      lastError = `slack returned ${res.status}: ${(await res.text()).slice(0, 256)}`;
    } catch (e) {
      lastError = e instanceof Error ? e.message : String(e);
    } finally {
      clearTimeout(timer);
    }

    if (attempt < SLACK_MAX_ATTEMPTS) {
      await new Promise((r) => setTimeout(r, 500 * attempt + 1_000 * (attempt - 1)));
    }
  }

  return { ok: false, error: lastError, status: lastStatus };
}
