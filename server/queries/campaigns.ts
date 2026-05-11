import "server-only";
import { and, desc, eq, ilike, inArray, sql } from "drizzle-orm";
import { getDb, schema } from "@/db/client";
import { clamp, escapeLikePattern } from "@/lib/utils";
import { newIncidentId } from "@/lib/incident";
import type { CampaignStatus } from "@/lib/campaign-status";

export type CampaignListItem = {
  id: string;
  name: string;
  status: CampaignStatus;
  hitlState: "REVIEW_REQUIRED" | "SEMI_AUTO" | "FULL_AUTO";
  ownerName: string | null;
  startsAt: string | null;
  leadsTotal: number;
  sent: number;
  replied: number;
  cvr: number; // 0..1
  lastActivityAt: string | null;
  anomaly: boolean; // running なのに 24h アクション無し
};

export type CampaignListResult = {
  items: CampaignListItem[];
  total: number;
  source: "live" | "mock" | "degraded";
  incidentId?: string;
};

export interface ListCampaignsArgs {
  orgId: string | null;
  status?: CampaignStatus | "";
  ownerUserId?: string | "";
  q?: string;
  page?: number;
  perPage?: number;
}

const Q_MAX_LEN = 120;
const PAGE_MAX = 1000;
const STAGNANT_MS = 24 * 60 * 60 * 1000;

function isStagnant(status: CampaignStatus, lastActivityAt: Date | null): boolean {
  if (status !== "running") return false;
  if (!lastActivityAt) return true;
  return Date.now() - lastActivityAt.getTime() > STAGNANT_MS;
}

export async function listCampaigns({
  orgId,
  status,
  ownerUserId,
  q,
  page = 1,
  perPage = 25,
}: ListCampaignsArgs): Promise<CampaignListResult> {
  const safePage = clamp(Math.floor(Number(page) || 1), 1, PAGE_MAX);
  const safePerPage = clamp(Math.floor(Number(perPage) || 25), 1, 100);
  const safeQ = (q ?? "").trim().slice(0, Q_MAX_LEN);

  const db = getDb();
  if (!db || !orgId) {
    return mockCampaigns({
      status,
      ownerUserId,
      q: safeQ,
      page: safePage,
      perPage: safePerPage,
    });
  }

  const conditions = [eq(schema.campaigns.orgId, orgId)];
  if (status) conditions.push(eq(schema.campaigns.status, status));
  if (ownerUserId) conditions.push(eq(schema.campaigns.ownerUserId, ownerUserId));
  if (safeQ) conditions.push(ilike(schema.campaigns.name, `%${escapeLikePattern(safeQ)}%`));

  const where = and(...conditions);
  const offset = (safePage - 1) * safePerPage;

  try {
    const [rows, totalRow] = await Promise.all([
      db
        .select({
          id: schema.campaigns.id,
          name: schema.campaigns.name,
          status: schema.campaigns.status,
          hitlState: schema.campaigns.hitlState,
          startsAt: schema.campaigns.startsAt,
          ownerName: schema.users.name,
        })
        .from(schema.campaigns)
        .leftJoin(schema.users, eq(schema.users.id, schema.campaigns.ownerUserId))
        .where(where)
        .orderBy(desc(schema.campaigns.createdAt))
        .limit(safePerPage)
        .offset(offset),
      db
        .select({ value: sql<number>`count(*)::int` })
        .from(schema.campaigns)
        .where(where),
    ]);

    const ids = rows.map((r) => r.id);
    const aggMap = new Map<
      string,
      { sent: number; replied: number; meeting: number; total: number; lastAt: Date | null }
    >();
    if (ids.length > 0) {
      const aggRows = await db
        .select({
          campaignId: schema.leads.campaignId,
          total: sql<number>`count(*)::int`,
          sent: sql<number>`count(*) filter (where ${schema.leads.state} in ('MESSAGED','REPLIED','MEETING','COMPLETED'))::int`,
          replied: sql<number>`count(*) filter (where ${schema.leads.state} in ('REPLIED','MEETING','COMPLETED'))::int`,
          meeting: sql<number>`count(*) filter (where ${schema.leads.state} in ('MEETING','COMPLETED'))::int`,
          lastAt: sql<Date | null>`max(${schema.leads.lastActionAt})`,
        })
        .from(schema.leads)
        .where(
          and(
            // 二重防御: orgId と campaignId in (...) 両方を要求
            eq(schema.leads.orgId, orgId),
            inArray(schema.leads.campaignId, ids)
          )
        )
        .groupBy(schema.leads.campaignId);

      for (const a of aggRows) {
        aggMap.set(a.campaignId, {
          sent: Number(a.sent),
          replied: Number(a.replied),
          meeting: Number(a.meeting),
          total: Number(a.total),
          lastAt: a.lastAt as Date | null,
        });
      }
    }

    const items: CampaignListItem[] = rows.map((r) => {
      const a = aggMap.get(r.id);
      const sent = a?.sent ?? 0;
      const replied = a?.replied ?? 0;
      const cvr = sent > 0 ? replied / sent : 0;
      const lastAt = a?.lastAt ?? null;
      return {
        id: r.id,
        name: r.name,
        status: r.status,
        hitlState: r.hitlState,
        ownerName: r.ownerName ?? null,
        startsAt: r.startsAt ? r.startsAt.toISOString() : null,
        leadsTotal: a?.total ?? 0,
        sent,
        replied,
        cvr,
        lastActivityAt: lastAt ? lastAt.toISOString() : null,
        anomaly: isStagnant(r.status, lastAt),
      };
    });

    return {
      items,
      total: Number(totalRow[0]?.value ?? 0),
      source: "live",
    };
  } catch (error) {
    const incidentId = newIncidentId();
    // 本番では Sentry.captureException(error, { tags: { incidentId } })
    if (process.env.NODE_ENV !== "production") {
      console.error(`[listCampaigns] ${incidentId}`, error);
    }
    return { items: [], total: 0, source: "degraded", incidentId };
  }
}

/* ---------------- Mock ---------------- */

function mockCampaigns({
  status,
  ownerUserId,
  q,
  page = 1,
  perPage = 25,
}: Omit<ListCampaignsArgs, "orgId">): CampaignListResult {
  const base: CampaignListItem[] = [
    mkRow("c1", "Series B SaaS · VPoE 開拓", "running", "REVIEW_REQUIRED", "林 翔太", 412, 32, hoursAgo(2)),
    mkRow("c2", "FinOps 製造業 — 経営層", "running", "SEMI_AUTO", "佐藤 美咲", 298, 18, hoursAgo(6)),
    mkRow("c3", "AI 採用スカウト Q2", "paused", "REVIEW_REQUIRED", "鈴木 大輔", 156, 9, hoursAgo(28)),
    mkRow("c4", "イベント招待 — TechBridge", "draft", "REVIEW_REQUIRED", "山本 拓也", 0, 0, null),
    mkRow("c5", "EU SaaS 共創パートナー", "completed", "REVIEW_REQUIRED", "田中 健司", 220, 28, hoursAgo(72)),
    mkRow("c6", "国内 BtoB マーケ — VP Marketing", "running", "REVIEW_REQUIRED", "林 翔太", 178, 11, hoursAgo(40)),
    mkRow("c7", "シリーズ A 採用責任者", "safe_mode", "REVIEW_REQUIRED", "鈴木 大輔", 88, 4, hoursAgo(10)),
    mkRow("c8", "DevOps DX 推進担当", "running", "REVIEW_REQUIRED", "佐藤 美咲", 134, 8, hoursAgo(3)),
    mkRow("c9", "国内 SaaS パートナー支援", "paused", "REVIEW_REQUIRED", "山本 拓也", 64, 2, hoursAgo(180)),
    mkRow("c10", "金融 DX 経営層 — 既存リード再活性", "draft", "REVIEW_REQUIRED", "田中 健司", 0, 0, null),
  ];

  let filtered = base;
  if (status) filtered = filtered.filter((r) => r.status === status);
  if (ownerUserId === "me") filtered = filtered.filter((r) => r.ownerName === "田中 健司");
  if (q) {
    const lower = q.toLowerCase();
    filtered = filtered.filter((r) => r.name.toLowerCase().includes(lower));
  }

  const total = filtered.length;
  const offset = (page - 1) * perPage;
  const items = filtered.slice(offset, offset + perPage);

  return { items, total, source: "mock" };
}

function mkRow(
  id: string,
  name: string,
  status: CampaignStatus,
  hitlState: CampaignListItem["hitlState"],
  ownerName: string,
  sent: number,
  replied: number,
  lastActivityAt: string | null
): CampaignListItem {
  const cvr = sent > 0 ? replied / sent : 0;
  const lastAt = lastActivityAt ? new Date(lastActivityAt) : null;
  return {
    id,
    name,
    status,
    hitlState,
    ownerName,
    startsAt: lastActivityAt,
    leadsTotal: Math.round(sent * 1.4),
    sent,
    replied,
    cvr,
    lastActivityAt,
    anomaly: isStagnant(status, lastAt),
  };
}

function hoursAgo(h: number): string {
  return new Date(Date.now() - h * 60 * 60 * 1000).toISOString();
}
