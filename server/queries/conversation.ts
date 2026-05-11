import "server-only";
import { and, desc, eq } from "drizzle-orm";
import { getDb, schema } from "@/db/client";
import { newIncidentId } from "@/lib/incident";
import type { LeadState } from "@/lib/state-machine";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type ConversationMessage = {
  id: string;
  direction: "outbound" | "inbound";
  content: string;
  aiAssisted: boolean;
  sentAt: string;
};

export type ConversationDetail = {
  lead: {
    id: string;
    name: string;
    headline: string | null;
    company: string | null;
    state: LeadState;
    score: number;
    linkedinUrl: string;
    campaignId: string;
    campaignName: string | null;
    ownerName: string | null;
    lastActionAt: string | null;
  };
  messages: ConversationMessage[];
};

export type ConversationResult =
  | { ok: true; detail: ConversationDetail; source: "live" | "mock" }
  | { ok: false; reason: "not_found" | "degraded"; incidentId?: string };

export async function getConversation(
  orgId: string | null,
  leadId: string
): Promise<ConversationResult> {
  const db = getDb();
  if (!db || !orgId) {
    const detail = mockConversation(leadId);
    if (!detail) return { ok: false, reason: "not_found" };
    return { ok: true, detail, source: "mock" };
  }

  if (!UUID_RE.test(leadId)) return { ok: false, reason: "not_found" };

  try {
    const [row] = await db
      .select({
        id: schema.leads.id,
        name: schema.leads.fullName,
        headline: schema.leads.headline,
        company: schema.leads.company,
        state: schema.leads.state,
        score: schema.leads.score,
        linkedinUrl: schema.leads.linkedinUrl,
        campaignId: schema.leads.campaignId,
        campaignName: schema.campaigns.name,
        ownerName: schema.users.name,
        lastActionAt: schema.leads.lastActionAt,
      })
      .from(schema.leads)
      .leftJoin(
        schema.campaigns,
        and(
          eq(schema.campaigns.id, schema.leads.campaignId),
          eq(schema.campaigns.orgId, orgId)
        )
      )
      .leftJoin(schema.users, eq(schema.users.id, schema.campaigns.ownerUserId))
      .where(and(eq(schema.leads.id, leadId), eq(schema.leads.orgId, orgId)))
      .limit(1);

    if (!row) return { ok: false, reason: "not_found" };

    // 直近 200 件を DESC で取得して反転 (LIMIT で古いログ side が落ちる問題を回避)
    const msgsDesc = await db
      .select({
        id: schema.messages.id,
        direction: schema.messages.direction,
        content: schema.messages.content,
        aiAssisted: schema.messages.aiAssisted,
        sentAt: schema.messages.sentAt,
      })
      .from(schema.messages)
      .where(eq(schema.messages.leadId, leadId))
      .orderBy(desc(schema.messages.sentAt))
      .limit(200);
    const msgs = msgsDesc.reverse();

    return {
      ok: true,
      source: "live",
      detail: {
        lead: {
          id: row.id,
          name: row.name ?? "(名前未取得)",
          headline: row.headline ?? null,
          company: row.company ?? null,
          state: row.state,
          score: row.score,
          linkedinUrl: row.linkedinUrl,
          campaignId: row.campaignId,
          campaignName: row.campaignName ?? null,
          ownerName: row.ownerName ?? null,
          lastActionAt: row.lastActionAt ? row.lastActionAt.toISOString() : null,
        },
        messages: msgs.map((m) => ({
          id: m.id,
          direction: m.direction,
          content: m.content,
          aiAssisted: m.aiAssisted,
          sentAt: m.sentAt.toISOString(),
        })),
      },
    };
  } catch (e) {
    const incidentId = newIncidentId();
    if (process.env.NODE_ENV !== "production") {
      console.error(`[getConversation] ${incidentId}`, e);
    }
    return { ok: false, reason: "degraded", incidentId };
  }
}

/* ---------------- Mock ---------------- */

function mockConversation(leadId: string): ConversationDetail | null {
  const lead = MOCK_LEADS[leadId];
  if (!lead) return null;
  return {
    lead,
    messages: MOCK_MESSAGES[leadId] ?? [],
  };
}

const MOCK_LEADS: Record<string, ConversationDetail["lead"]> = {
  l1: {
    id: "l1",
    name: "山田 太郎",
    headline: "VP of Engineering",
    company: "Acme Inc.",
    state: "REPLIED",
    score: 86,
    linkedinUrl: "https://www.linkedin.com/in/example-yamada",
    campaignId: "c1",
    campaignName: "Series B SaaS · VPoE 開拓",
    ownerName: "林 翔太",
    lastActionAt: new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString(),
  },
  l8: {
    id: "l8",
    name: "森田 翼",
    headline: "CTO",
    company: "Theta",
    state: "MEETING",
    score: 92,
    linkedinUrl: "https://www.linkedin.com/in/example-morita",
    campaignId: "c1",
    campaignName: "Series B SaaS · VPoE 開拓",
    ownerName: "林 翔太",
    lastActionAt: new Date(Date.now() - 1 * 60 * 60 * 1000).toISOString(),
  },
  l9: {
    id: "l9",
    name: "池田 大樹",
    headline: "Director of Engineering",
    company: "Iota",
    state: "REPLIED",
    score: 74,
    linkedinUrl: "https://www.linkedin.com/in/example-ikeda",
    campaignId: "c3",
    campaignName: "AI 採用スカウト Q2",
    ownerName: "鈴木 大輔",
    lastActionAt: new Date(Date.now() - 1 * 60 * 60 * 1000).toISOString(),
  },
};

const MOCK_MESSAGES: Record<string, ConversationMessage[]> = {
  l1: [
    msg("m1-1", "outbound", "突然のご連絡失礼いたします。Acme 様の事業を拝見し、AI 駆動の SDR 支援が組み合わせやすそうだと感じご連絡しました。", false, 72),
    msg("m1-2", "inbound", "ご連絡ありがとうございます。少し興味があります。", false, 48),
    msg("m1-3", "outbound", "ありがとうございます。差し支えなければ、現在の SDR 体制と、月次の新規商談数の目安を教えていただけますか？", true, 36),
    msg(
      "m1-4",
      "inbound",
      "SDR は 2 名で、新規商談は月 25 件前後です。価格と他社比較について、もう少し詳しくお伺いできますでしょうか。",
      false,
      3
    ),
  ],
  l8: [
    msg("m8-1", "outbound", "ご返信ありがとうございます。来週火曜 15:00 でいかがでしょうか？", false, 26),
    msg("m8-2", "inbound", "了解しました。火曜の 15:00 でお願いします。", false, 24),
    msg(
      "m8-3",
      "outbound",
      "ありがとうございます。当日のアジェンダをお送りします。事前に確認いただきたい資料も添付いたしました。",
      true,
      1
    ),
  ],
  l9: [
    msg(
      "m9-1",
      "outbound",
      "Iota 様のエンジニアリング採用方針に関心があります。少しだけお話する機会をいただけますでしょうか。",
      true,
      18
    ),
    msg(
      "m9-2",
      "inbound",
      "ありがとうございます。来月にぜひ一度お話できますと幸いです。",
      false,
      1
    ),
  ],
};

function msg(
  id: string,
  direction: "outbound" | "inbound",
  content: string,
  aiAssisted: boolean,
  hoursAgo: number
): ConversationMessage {
  return {
    id,
    direction,
    content,
    aiAssisted,
    sentAt: new Date(Date.now() - hoursAgo * 60 * 60 * 1000).toISOString(),
  };
}
