import "server-only";
import { and, desc, eq, inArray, ilike, sql } from "drizzle-orm";
import { getDb, schema } from "@/db/client";
import { clamp, escapeLikePattern } from "@/lib/utils";
import { newIncidentId } from "@/lib/incident";
import type { LeadState } from "@/lib/state-machine";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** SLA 一次応答: 設計書 §25.3 = 受信から 2 時間以内 (営業時間) → 簡略 2h で判定 */
const SLA_HOURS = 2;
const SLA_MS = SLA_HOURS * 60 * 60 * 1000;

export type ThreadFilter = "all" | "unread" | "review" | "meeting";

export type InboxThread = {
  leadId: string;
  leadName: string;
  leadHeadline: string | null;
  leadCompany: string | null;
  state: LeadState;
  campaignId: string;
  campaignName: string | null;
  ownerName: string | null;
  score: number;
  lastMessageAt: string | null;
  lastMessageSnippet: string | null;
  lastDirection: "outbound" | "inbound" | null;
  /** REPLIED & 2h 経過で true (簡略実装) */
  slaBreached: boolean;
  /** REPLIED 状態 = 要レビュー */
  requiresReview: boolean;
};

export type InboxResult = {
  threads: InboxThread[];
  total: number;
  counts: {
    all: number;
    unread: number;
    review: number;
    meeting: number;
  };
  source: "live" | "mock" | "degraded";
  incidentId?: string;
};

export interface ListThreadsArgs {
  orgId: string | null;
  filter?: ThreadFilter;
  q?: string;
  page?: number;
  perPage?: number;
}

const Q_MAX_LEN = 120;
const PAGE_MAX = 1000;

export async function listInboxThreads({
  orgId,
  filter = "all",
  q,
  page = 1,
  perPage = 30,
}: ListThreadsArgs): Promise<InboxResult> {
  const safePage = clamp(Math.floor(Number(page) || 1), 1, PAGE_MAX);
  const safePerPage = clamp(Math.floor(Number(perPage) || 30), 10, 100);
  const safeQ = (q ?? "").trim().slice(0, Q_MAX_LEN);

  const db = getDb();
  if (!db || !orgId) {
    return mockInbox({ filter, q: safeQ, page: safePage, perPage: safePerPage });
  }

  // 状態ベースのスレッドフィルタ (リード state を使う)
  const stateFilter: LeadState[] =
    filter === "review"
      ? ["REPLIED"]
      : filter === "meeting"
      ? ["MEETING"]
      : filter === "unread"
      ? ["REPLIED", "MEETING"]
      : []; // all

  const conditions = [eq(schema.leads.orgId, orgId)];
  if (stateFilter.length > 0) conditions.push(inArray(schema.leads.state, stateFilter));
  if (safeQ) {
    const like = `%${escapeLikePattern(safeQ)}%`;
    conditions.push(
      sql`(${schema.leads.fullName} ILIKE ${like} OR ${schema.leads.company} ILIKE ${like})`
    );
  }
  // 受信箱は「対話が始まっているもの」を対象 (MESSAGED 以降)
  conditions.push(
    sql`${schema.leads.state} in ('MESSAGED','REPLIED','MEETING','COMPLETED','FAILED')`
  );

  const where = and(...conditions);
  const offset = (safePage - 1) * safePerPage;

  try {
    const [rows, totalRow, statusCounts] = await Promise.all([
      db
        .select({
          leadId: schema.leads.id,
          leadName: schema.leads.fullName,
          leadHeadline: schema.leads.headline,
          leadCompany: schema.leads.company,
          state: schema.leads.state,
          score: schema.leads.score,
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
        .where(where)
        .orderBy(desc(schema.leads.lastActionAt))
        .limit(safePerPage)
        .offset(offset),
      db.select({ value: sql<number>`count(*)::int` }).from(schema.leads).where(where),
      db
        .select({ state: schema.leads.state, count: sql<number>`count(*)::int` })
        .from(schema.leads)
        .where(
          and(
            eq(schema.leads.orgId, orgId),
            sql`${schema.leads.state} in ('MESSAGED','REPLIED','MEETING','COMPLETED','FAILED')`
          )
        )
        .groupBy(schema.leads.state),
    ]);

    const leadIds = rows.map((r) => r.leadId);
    const lastMessages = new Map<
      string,
      { content: string; direction: "outbound" | "inbound"; sentAt: Date }
    >();
    if (leadIds.length > 0) {
      // Defense-in-Depth: messages を leads と inner join し orgId を二重で要求。
      // leadIds は既に orgId scope で取得済みだが、設計書 §17 ABAC の二重防御を堅持する。
      type MessageRow = {
        lead_id: string;
        content: string;
        direction: "outbound" | "inbound";
        sent_at: string | Date;
      };
      const msgResult = await db.execute<MessageRow>(
        sql`
          select m.lead_id, m.content, m.direction, m.sent_at
          from (
            select
              m0.lead_id,
              m0.content,
              m0.direction,
              m0.sent_at,
              row_number() over (partition by m0.lead_id order by m0.sent_at desc) as rn
            from messages m0
            inner join leads l on l.id = m0.lead_id and l.org_id = ${orgId}
            where m0.lead_id in (${sql.join(leadIds, sql`, `)})
          ) m
          where m.rn = 1
        `
      );
      // drizzle postgres-js: execute<T>() の戻り値は (T & { /* meta */ })[]。
      // 型不整合を避けるため、定型 cast で row 配列に揃える。
      const rawRows = (msgResult as unknown as MessageRow[]) ?? [];
      for (const r of rawRows) {
        const sentAt = r.sent_at instanceof Date ? r.sent_at : new Date(r.sent_at);
        lastMessages.set(r.lead_id, {
          content: r.content ?? "",
          direction: r.direction ?? "outbound",
          sentAt,
        });
      }
    }

    const now = Date.now();
    const threads: InboxThread[] = rows.map((r) => {
      const lastMsg = lastMessages.get(r.leadId);
      const lastAt = lastMsg?.sentAt ?? (r.lastActionAt ?? null);
      const isReplied = r.state === "REPLIED";
      const slaBreached =
        isReplied && lastAt instanceof Date
          ? now - lastAt.getTime() > SLA_MS
          : false;
      return {
        leadId: r.leadId,
        leadName: r.leadName ?? "(名前未取得)",
        leadHeadline: r.leadHeadline ?? null,
        leadCompany: r.leadCompany ?? null,
        state: r.state,
        score: r.score,
        campaignId: r.campaignId,
        campaignName: r.campaignName ?? null,
        ownerName: r.ownerName ?? null,
        lastMessageAt:
          lastAt instanceof Date ? lastAt.toISOString() : null,
        lastMessageSnippet: lastMsg ? snippet(lastMsg.content) : null,
        lastDirection: lastMsg?.direction ?? null,
        slaBreached,
        requiresReview: isReplied,
      };
    });

    const statusMap = new Map(statusCounts.map((s) => [s.state, Number(s.count)]));
    const total = Number(totalRow[0]?.value ?? 0);
    const counts = {
      all: Array.from(statusMap.values()).reduce((a, b) => a + b, 0),
      unread:
        (statusMap.get("REPLIED") ?? 0) + (statusMap.get("MEETING") ?? 0),
      review: statusMap.get("REPLIED") ?? 0,
      meeting: statusMap.get("MEETING") ?? 0,
    };

    return { threads, total, counts, source: "live" };
  } catch (e) {
    const incidentId = newIncidentId();
    if (process.env.NODE_ENV !== "production") {
      console.error(`[listInboxThreads] ${incidentId}`, e);
    }
    return {
      threads: [],
      total: 0,
      counts: { all: 0, unread: 0, review: 0, meeting: 0 },
      source: "degraded",
      incidentId,
    };
  }
}

function snippet(content: string, max = 80): string {
  const trimmed = content.replace(/\s+/g, " ").trim();
  if (trimmed.length <= max) return trimmed;
  return trimmed.slice(0, max - 1) + "…";
}

export { UUID_RE };

/* ---------------- Mock ---------------- */

function mockInbox({
  filter = "all",
  q = "",
  page = 1,
  perPage = 30,
}: Omit<ListThreadsArgs, "orgId">): InboxResult {
  const all = MOCK_THREADS.slice();
  let filtered = all;
  if (filter === "review") filtered = all.filter((t) => t.state === "REPLIED");
  else if (filter === "meeting") filtered = all.filter((t) => t.state === "MEETING");
  else if (filter === "unread")
    filtered = all.filter((t) => t.state === "REPLIED" || t.state === "MEETING");
  if (q) {
    const lower = q.toLowerCase();
    filtered = filtered.filter(
      (t) =>
        t.leadName.toLowerCase().includes(lower) ||
        (t.leadCompany?.toLowerCase() ?? "").includes(lower)
    );
  }
  const total = filtered.length;
  const offset = (page - 1) * perPage;
  return {
    threads: filtered.slice(offset, offset + perPage),
    total,
    counts: {
      all: all.length,
      unread: all.filter((t) => t.state === "REPLIED" || t.state === "MEETING").length,
      review: all.filter((t) => t.state === "REPLIED").length,
      meeting: all.filter((t) => t.state === "MEETING").length,
    },
    source: "mock",
  };
}

function ago(h: number) {
  return new Date(Date.now() - h * 60 * 60 * 1000).toISOString();
}

const MOCK_THREADS: InboxThread[] = [
  thread(
    "l1",
    "山田 太郎",
    "VP of Engineering",
    "Acme Inc.",
    "REPLIED",
    86,
    "c1",
    "Series B SaaS · VPoE 開拓",
    "林 翔太",
    3,
    "inbound",
    "ご返信ありがとうございます。価格と他社比較について、もう少し詳しくお伺いできますでしょうか。",
    true
  ),
  thread(
    "l9",
    "池田 大樹",
    "Director of Engineering",
    "Iota",
    "REPLIED",
    74,
    "c3",
    "AI 採用スカウト Q2",
    "鈴木 大輔",
    1,
    "inbound",
    "ありがとうございます。来月にぜひ一度お話できますと幸いです。"
  ),
  thread(
    "l8",
    "森田 翼",
    "CTO",
    "Theta",
    "MEETING",
    92,
    "c1",
    "Series B SaaS · VPoE 開拓",
    "林 翔太",
    1,
    "outbound",
    "お時間のご調整ありがとうございます。当日のアジェンダをお送りします。"
  ),
  thread(
    "l14",
    "岡田 健太郎",
    "VPoE",
    "Xi",
    "MEETING",
    88,
    "c2",
    "FinOps 製造業 — 経営層",
    "佐藤 美咲",
    4,
    "inbound",
    "了解しました。火曜の 15:00 でお願いします。"
  ),
  thread(
    "l2",
    "佐藤 花子",
    "VPoE",
    "Beta Holdings",
    "MESSAGED",
    78,
    "c1",
    "Series B SaaS · VPoE 開拓",
    "林 翔太",
    8,
    "outbound",
    "初めてご連絡いたします。御社の事業をいつも拝見しております。"
  ),
  thread(
    "l11",
    "藤本 蓮",
    "VP of Engineering",
    "Lambda",
    "MESSAGED",
    81,
    "c2",
    "FinOps 製造業 — 経営層",
    "佐藤 美咲",
    12,
    "outbound",
    "突然のご連絡失礼いたします。"
  ),
  thread(
    "l12",
    "野村 純",
    "CTO",
    "Mu",
    "FAILED",
    55,
    "c3",
    "AI 採用スカウト Q2",
    "鈴木 大輔",
    90,
    "outbound",
    "送信に失敗しました。"
  ),
];

function thread(
  leadId: string,
  leadName: string,
  leadHeadline: string,
  leadCompany: string,
  state: LeadState,
  score: number,
  campaignId: string,
  campaignName: string,
  ownerName: string,
  hoursAgo: number,
  lastDirection: "outbound" | "inbound" | null,
  snippetText: string | null,
  forceSlaBreached?: boolean
): InboxThread {
  const lastAt = ago(hoursAgo);
  const isReplied = state === "REPLIED";
  const slaBreached =
    forceSlaBreached ??
    (isReplied && Date.now() - new Date(lastAt).getTime() > SLA_MS);
  return {
    leadId,
    leadName,
    leadHeadline,
    leadCompany,
    state,
    score,
    campaignId,
    campaignName,
    ownerName,
    lastMessageAt: snippetText ? lastAt : null,
    lastMessageSnippet: snippetText,
    lastDirection,
    slaBreached,
    requiresReview: isReplied,
  };
}
