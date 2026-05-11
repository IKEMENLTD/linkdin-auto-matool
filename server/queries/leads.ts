import "server-only";
import { and, desc, eq, gte, sql } from "drizzle-orm";
import { getDb, schema } from "@/db/client";
import { clamp, escapeLikePattern } from "@/lib/utils";
import { newIncidentId } from "@/lib/incident";
import {
  STATE_ORDER,
  STATE_SHORT_LABEL,
  type LeadState,
} from "@/lib/state-machine";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type LeadListItem = {
  id: string;
  name: string;
  headline: string | null;
  company: string | null;
  state: LeadState;
  score: number;
  campaignId: string;
  campaignName: string | null;
  ownerName: string | null;
  lastActionAt: string | null;
};

export type LeadListResult = {
  items: LeadListItem[];
  total: number;
  source: "live" | "mock" | "degraded";
  incidentId?: string;
};

export interface ListLeadsArgs {
  orgId: string | null;
  state?: LeadState | "";
  campaignId?: string | "";
  q?: string;
  scoreMin?: number;
  page?: number;
  perPage?: number;
}

const Q_MAX_LEN = 120;
const PAGE_MAX = 2000;

export async function listLeads({
  orgId,
  state,
  campaignId,
  q,
  scoreMin,
  page = 1,
  perPage = 50,
}: ListLeadsArgs): Promise<LeadListResult> {
  const safePage = clamp(Math.floor(Number(page) || 1), 1, PAGE_MAX);
  const safePerPage = clamp(Math.floor(Number(perPage) || 50), 10, 100);
  const safeQ = (q ?? "").trim().slice(0, Q_MAX_LEN);
  const safeScoreMin = clamp(Math.floor(Number(scoreMin) || 0), 0, 100);

  const db = getDb();
  if (!db || !orgId) {
    return mockLeads({
      state,
      campaignId,
      q: safeQ,
      scoreMin: safeScoreMin,
      page: safePage,
      perPage: safePerPage,
    });
  }

  const conditions = [eq(schema.leads.orgId, orgId)];
  if (state) conditions.push(eq(schema.leads.state, state));
  if (campaignId && UUID_RE.test(campaignId)) {
    conditions.push(eq(schema.leads.campaignId, campaignId));
  }
  if (safeScoreMin > 0) conditions.push(gte(schema.leads.score, safeScoreMin));
  if (safeQ) {
    const like = `%${escapeLikePattern(safeQ)}%`;
    conditions.push(
      sql`(${schema.leads.fullName} ILIKE ${like} OR ${schema.leads.company} ILIKE ${like} OR ${schema.leads.headline} ILIKE ${like})`
    );
  }

  const where = and(...conditions);
  const offset = (safePage - 1) * safePerPage;

  try {
    const [rows, totalRow] = await Promise.all([
      db
        .select({
          id: schema.leads.id,
          name: schema.leads.fullName,
          headline: schema.leads.headline,
          company: schema.leads.company,
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
      db
        .select({ value: sql<number>`count(*)::int` })
        .from(schema.leads)
        .where(where),
    ]);

    return {
      items: rows.map((r) => ({
        id: r.id,
        name: r.name ?? "(名前未取得)",
        headline: r.headline ?? null,
        company: r.company ?? null,
        state: r.state,
        score: r.score,
        campaignId: r.campaignId,
        campaignName: r.campaignName ?? null,
        ownerName: r.ownerName ?? null,
        lastActionAt: r.lastActionAt ? r.lastActionAt.toISOString() : null,
      })),
      total: Number(totalRow[0]?.value ?? 0),
      source: "live",
    };
  } catch (e) {
    const incidentId = newIncidentId();
    if (process.env.NODE_ENV !== "production") {
      console.error(`[listLeads] ${incidentId}`, e);
    }
    return { items: [], total: 0, source: "degraded", incidentId };
  }
}

export async function getCampaignNamesForFilter(
  orgId: string | null
): Promise<{ id: string; name: string }[]> {
  const db = getDb();
  if (!db || !orgId) {
    return [
      { id: "c1", name: "Series B SaaS · VPoE 開拓" },
      { id: "c2", name: "FinOps 製造業 — 経営層" },
      { id: "c3", name: "AI 採用スカウト Q2" },
    ];
  }
  try {
    const rows = await db
      .select({ id: schema.campaigns.id, name: schema.campaigns.name })
      .from(schema.campaigns)
      .where(eq(schema.campaigns.orgId, orgId))
      .orderBy(desc(schema.campaigns.createdAt))
      .limit(50);
    return rows.map((r) => ({ id: r.id, name: r.name }));
  } catch {
    return [];
  }
}

export async function getLeadById(
  orgId: string | null,
  leadId: string
): Promise<LeadListItem | null> {
  // UUID 形式チェック (mock id "l1" 等は DB 未接続時のみ通す)
  const db = getDb();
  if (!db || !orgId) {
    return mockLeads({}).items.find((l) => l.id === leadId) ?? null;
  }
  if (!UUID_RE.test(leadId)) return null;

  try {
    const [row] = await db
      .select({
        id: schema.leads.id,
        name: schema.leads.fullName,
        headline: schema.leads.headline,
        company: schema.leads.company,
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
      .where(and(eq(schema.leads.id, leadId), eq(schema.leads.orgId, orgId)))
      .limit(1);
    if (!row) return null;
    return {
      id: row.id,
      name: row.name ?? "(名前未取得)",
      headline: row.headline ?? null,
      company: row.company ?? null,
      state: row.state,
      score: row.score,
      campaignId: row.campaignId,
      campaignName: row.campaignName ?? null,
      ownerName: row.ownerName ?? null,
      lastActionAt: row.lastActionAt ? row.lastActionAt.toISOString() : null,
    };
  } catch (e) {
    const incidentId = newIncidentId();
    if (process.env.NODE_ENV !== "production") {
      console.error(`[getLeadById] ${incidentId}`, e);
    }
    return null;
  }
}

/* ---------------- Mock ---------------- */

const MOCK_LEADS: LeadListItem[] = [
  mk("l1", "山田 太郎", "VP of Engineering", "Acme Inc.", "REPLIED", 86, "c1", "Series B SaaS · VPoE 開拓", "林 翔太", 3),
  mk("l2", "佐藤 花子", "VPoE", "Beta Holdings", "MESSAGED", 78, "c1", "Series B SaaS · VPoE 開拓", "林 翔太", 8),
  mk("l3", "鈴木 一郎", "CTO", "Gamma Studio", "CONNECTED", 72, "c2", "FinOps 製造業 — 経営層", "佐藤 美咲", 20),
  mk("l4", "高橋 健", "VPoE", "Delta Labs", "PENDING", 68, "c2", "FinOps 製造業 — 経営層", "佐藤 美咲", 28),
  mk("l5", "渡辺 美咲", "Engineering Manager", "Epsilon", "DISQUALIFIED", 42, "c3", "AI 採用スカウト Q2", "鈴木 大輔", 50),
  mk("l6", "中村 浩二", "VP of Engineering", "Zeta", "QUALIFIED", 80, "c1", "Series B SaaS · VPoE 開拓", "林 翔太", 2),
  mk("l7", "小林 直人", "VPoE", "Eta Corp", "ENRICHED", 75, "c2", "FinOps 製造業 — 経営層", "佐藤 美咲", 36),
  mk("l8", "森田 翼", "CTO", "Theta", "MEETING", 92, "c1", "Series B SaaS · VPoE 開拓", "林 翔太", 1),
  mk("l9", "池田 大樹", "Director of Engineering", "Iota", "REPLIED", 74, "c3", "AI 採用スカウト Q2", "鈴木 大輔", 5),
  mk("l10", "石田 涼子", "VPoE", "Kappa", "DISCOVERED", 64, "c1", "Series B SaaS · VPoE 開拓", "林 翔太", 100),
  mk("l11", "藤本 蓮", "VP of Engineering", "Lambda", "MESSAGED", 81, "c2", "FinOps 製造業 — 経営層", "佐藤 美咲", 12),
  mk("l12", "野村 純", "CTO", "Mu", "FAILED", 55, "c3", "AI 採用スカウト Q2", "鈴木 大輔", 90),
  mk("l13", "三宅 良", "Head of Engineering", "Nu", "CONNECTED", 70, "c1", "Series B SaaS · VPoE 開拓", "林 翔太", 18),
  mk("l14", "岡田 健太郎", "VPoE", "Xi", "MEETING", 88, "c2", "FinOps 製造業 — 経営層", "佐藤 美咲", 4),
  mk("l15", "上田 拓海", "CTO", "Omicron", "QUALIFIED", 79, "c1", "Series B SaaS · VPoE 開拓", "林 翔太", 22),
];

function mockLeads({
  state,
  campaignId,
  q = "",
  scoreMin = 0,
  page = 1,
  perPage = 50,
}: Omit<ListLeadsArgs, "orgId">): LeadListResult {
  let filtered = MOCK_LEADS.slice();
  if (state) filtered = filtered.filter((l) => l.state === state);
  if (campaignId) filtered = filtered.filter((l) => l.campaignId === campaignId);
  if (scoreMin > 0) filtered = filtered.filter((l) => l.score >= scoreMin);
  if (q) {
    const lower = q.toLowerCase();
    filtered = filtered.filter(
      (l) =>
        l.name.toLowerCase().includes(lower) ||
        (l.company?.toLowerCase() ?? "").includes(lower) ||
        (l.headline?.toLowerCase() ?? "").includes(lower)
    );
  }
  filtered.sort((a, b) => {
    const ax = a.lastActionAt ? new Date(a.lastActionAt).getTime() : 0;
    const bx = b.lastActionAt ? new Date(b.lastActionAt).getTime() : 0;
    return bx - ax;
  });
  const total = filtered.length;
  const offset = (page - 1) * perPage;
  return { items: filtered.slice(offset, offset + perPage), total, source: "mock" };
}

function mk(
  id: string,
  name: string,
  headline: string,
  company: string,
  state: LeadState,
  score: number,
  campaignId: string,
  campaignName: string,
  ownerName: string,
  hoursAgo: number
): LeadListItem {
  return {
    id,
    name,
    headline,
    company,
    state,
    score,
    campaignId,
    campaignName,
    ownerName,
    lastActionAt: new Date(Date.now() - hoursAgo * 60 * 60 * 1000).toISOString(),
  };
}

export const LEAD_STATE_OPTIONS = [
  { value: "", label: "すべての状態" },
  ...STATE_ORDER.map((s) => ({ value: s, label: STATE_SHORT_LABEL[s] })),
];
