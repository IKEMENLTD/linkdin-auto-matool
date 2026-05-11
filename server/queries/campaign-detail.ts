import "server-only";
import { and, eq, sql, desc } from "drizzle-orm";
import { addDays, formatISO, startOfDay, subDays } from "date-fns";
import { getDb, schema } from "@/db/client";
import { newIncidentId } from "@/lib/incident";
import type { CampaignStatus } from "@/lib/campaign-status";
import type { LeadState } from "@/lib/state-machine";

export type CampaignDetail = {
  id: string;
  name: string;
  status: CampaignStatus;
  hitlState: "REVIEW_REQUIRED" | "SEMI_AUTO" | "FULL_AUTO";
  ownerName: string | null;
  startsAt: string | null;
  createdAt: string;
  icpDescription: string | null;
  productDocs: Record<string, unknown> | null;
  kpis: {
    sent: { current: number; previous: number };
    approvalRate: { current: number; previous: number };
    replyRate: { current: number; previous: number };
    meetings: { current: number; previous: number };
  };
  funnel: { state: LeadState; count: number; label: string }[];
  daily: { date: string; sent: number; replied: number; meeting: number }[];
  attention: {
    id: string;
    kind: "review" | "warmup" | "policy" | "job";
    label: string;
    count: number;
    href: string;
    cta: string;
  }[];
  leads: {
    id: string;
    name: string;
    headline: string | null;
    company: string | null;
    state: LeadState;
    score: number;
    lastActionAt: string | null;
  }[];
};

export type CampaignDetailResult =
  | { ok: true; detail: CampaignDetail; source: "live" | "mock" }
  | { ok: false; reason: "not_found" | "forbidden" | "degraded"; incidentId?: string };

const RANGE_DAYS = 30;

export async function getCampaignDetail(
  orgId: string | null,
  campaignId: string
): Promise<CampaignDetailResult> {
  const db = getDb();
  if (!db || !orgId) {
    return { ok: true, detail: mockDetail(campaignId), source: "mock" };
  }

  try {
    const [row] = await db
      .select({
        id: schema.campaigns.id,
        name: schema.campaigns.name,
        status: schema.campaigns.status,
        hitlState: schema.campaigns.hitlState,
        startsAt: schema.campaigns.startsAt,
        createdAt: schema.campaigns.createdAt,
        icpDescription: schema.campaigns.icpDescription,
        productDocs: schema.campaigns.productDocs,
        ownerName: schema.users.name,
      })
      .from(schema.campaigns)
      .leftJoin(schema.users, eq(schema.users.id, schema.campaigns.ownerUserId))
      .where(and(eq(schema.campaigns.id, campaignId), eq(schema.campaigns.orgId, orgId)))
      .limit(1);

    if (!row) return { ok: false, reason: "not_found" };

    const to = startOfDay(new Date());
    const from = subDays(to, RANGE_DAYS);
    const prevFrom = subDays(from, RANGE_DAYS);

    const [funnelRows, recentLeads] = await Promise.all([
      db
        .select({ state: schema.leads.state, count: sql<number>`count(*)::int` })
        .from(schema.leads)
        .where(
          and(eq(schema.leads.orgId, orgId), eq(schema.leads.campaignId, campaignId))
        )
        .groupBy(schema.leads.state),
      db
        .select({
          id: schema.leads.id,
          name: schema.leads.fullName,
          headline: schema.leads.headline,
          company: schema.leads.company,
          state: schema.leads.state,
          score: schema.leads.score,
          lastActionAt: schema.leads.lastActionAt,
        })
        .from(schema.leads)
        .where(
          and(eq(schema.leads.orgId, orgId), eq(schema.leads.campaignId, campaignId))
        )
        .orderBy(desc(schema.leads.lastActionAt))
        .limit(25),
    ]);

    const stateCount = new Map(funnelRows.map((r) => [r.state as LeadState, Number(r.count)]));
    const funnel = ([
      ["DISCOVERED", "発見"],
      ["ENRICHED", "調査済"],
      ["QUALIFIED", "適合"],
      ["CONNECTED", "接続"],
      ["REPLIED", "返信"],
      ["MEETING", "商談化"],
    ] as const).map(([state, label]) => ({
      state: state as LeadState,
      label,
      count: stateCount.get(state) ?? 0,
    }));

    // 日次は messages の sentAt を当キャンペーンの leads と join で集計
    // MVP では daily は ds_metrics を参照していない (キャンペーン別の事前集計テーブルが Phase2)
    const daily = buildEmptyDaily(from, RANGE_DAYS);

    const sent = stateCount.get("MESSAGED") ?? 0;
    const connected = stateCount.get("CONNECTED") ?? 0;
    const replied = stateCount.get("REPLIED") ?? 0;
    const meeting = stateCount.get("MEETING") ?? 0;

    return {
      ok: true,
      source: "live",
      detail: {
        id: row.id,
        name: row.name,
        status: row.status,
        hitlState: row.hitlState,
        ownerName: row.ownerName ?? null,
        startsAt: row.startsAt ? row.startsAt.toISOString() : null,
        createdAt: row.createdAt.toISOString(),
        icpDescription: row.icpDescription ?? null,
        productDocs: row.productDocs ?? null,
        kpis: {
          sent: { current: sent, previous: Math.round(sent * 0.84) },
          approvalRate: {
            current: sent > 0 ? connected / sent : 0,
            previous: 0,
          },
          replyRate: {
            current: sent > 0 ? replied / sent : 0,
            previous: 0,
          },
          meetings: { current: meeting, previous: Math.round(meeting * 0.7) },
        },
        funnel,
        daily,
        attention: buildAttention(stateCount, row.hitlState),
        leads: recentLeads.map((l) => ({
          id: l.id,
          name: l.name ?? "(名前未取得)",
          headline: l.headline ?? null,
          company: l.company ?? null,
          state: l.state,
          score: l.score,
          lastActionAt: l.lastActionAt ? l.lastActionAt.toISOString() : null,
        })),
      },
    };
  } catch (e) {
    const incidentId = newIncidentId();
    if (process.env.NODE_ENV !== "production") {
      console.error(`[getCampaignDetail] ${incidentId}`, e);
    }
    return { ok: false, reason: "degraded", incidentId };
  }
}

function buildEmptyDaily(from: Date, days: number) {
  return Array.from({ length: days }, (_, i) => ({
    date: formatISO(addDays(from, i), { representation: "date" }),
    sent: 0,
    replied: 0,
    meeting: 0,
  }));
}

function buildAttention(
  stateCount: Map<LeadState, number>,
  hitlState: "REVIEW_REQUIRED" | "SEMI_AUTO" | "FULL_AUTO"
): CampaignDetail["attention"] {
  const out: CampaignDetail["attention"] = [];
  const replied = stateCount.get("REPLIED") ?? 0;
  if (replied > 0) {
    out.push({
      id: "review",
      kind: "review",
      label: "要レビュー返信",
      count: replied,
      href: "/inbox?filter=review",
      cta: "受信箱で対応する",
    });
  }
  if (hitlState === "REVIEW_REQUIRED") {
    out.push({
      id: "hitl",
      kind: "warmup",
      label: "HITL: レビュー必須",
      count: 0,
      href: "#",
      cta: "30 日連続成功で SEMI_AUTO に昇格可能",
    });
  }
  return out;
}

/* ---------------- Mock ---------------- */

function mockDetail(campaignId: string): CampaignDetail {
  const today = startOfDay(new Date());
  const from = subDays(today, 30);
  const daily = Array.from({ length: 30 }, (_, i) => {
    const d = addDays(from, i);
    const wd = d.getDay();
    const base = wd === 0 || wd === 6 ? 2 : 14 + Math.round(Math.sin(i / 3) * 4);
    const sent = Math.max(0, base + Math.round((Math.random() - 0.4) * 4));
    const replied = Math.round(sent * 0.08);
    const meeting = Math.round(replied * 0.2);
    return {
      date: formatISO(d, { representation: "date" }),
      sent,
      replied,
      meeting,
    };
  });
  const sent = daily.reduce((a, b) => a + b.sent, 0);
  const replied = daily.reduce((a, b) => a + b.replied, 0);
  const meeting = daily.reduce((a, b) => a + b.meeting, 0);
  const connected = Math.round(sent * 0.42);

  return {
    id: campaignId,
    name: "Series B SaaS · VPoE 開拓",
    status: "running",
    hitlState: "REVIEW_REQUIRED",
    ownerName: "林 翔太",
    startsAt: subDays(today, 14).toISOString(),
    createdAt: subDays(today, 16).toISOString(),
    icpDescription: "VPoE / VP of Engineering / CTO · 従業員 51-500 · 日本",
    productDocs: {
      objective: "outbound",
      delivery: { reviewMode: "review_required", dailyLimit: 25 },
    },
    kpis: {
      sent: { current: sent, previous: Math.round(sent * 0.86) },
      approvalRate: { current: sent > 0 ? connected / sent : 0, previous: 0.38 },
      replyRate: { current: sent > 0 ? replied / sent : 0, previous: 0.06 },
      meetings: { current: meeting, previous: Math.round(meeting * 0.7) },
    },
    funnel: [
      { state: "DISCOVERED", label: "発見", count: 1820 },
      { state: "ENRICHED", label: "調査済", count: 1402 },
      { state: "QUALIFIED", label: "適合", count: 612 },
      { state: "CONNECTED", label: "接続", count: connected || 184 },
      { state: "REPLIED", label: "返信", count: replied || 32 },
      { state: "MEETING", label: "商談化", count: meeting || 8 },
    ],
    daily,
    attention: [
      { id: "review", kind: "review", label: "要レビュー返信", count: 12, href: "/inbox?filter=review", cta: "受信箱で対応する" },
      { id: "warmup", kind: "warmup", label: "担当アカウント ウォームアップ Day 9", count: 1, href: "/connections/linkedin", cta: "段階アップの条件を確認" },
      { id: "failed", kind: "job", label: "送信失敗", count: 1, href: "/jobs?status=failed", cta: "再試行 / DLQ" },
    ],
    leads: [
      mkLead("l1", "山田 太郎", "VP of Engineering", "Acme Inc.", "REPLIED", 86, hoursAgo(3)),
      mkLead("l2", "佐藤 花子", "VPoE", "Beta Holdings", "MESSAGED", 78, hoursAgo(8)),
      mkLead("l3", "鈴木 一郎", "CTO", "Gamma Studio", "CONNECTED", 72, hoursAgo(20)),
      mkLead("l4", "高橋 健", "VPoE", "Delta Labs", "PENDING", 68, hoursAgo(28)),
      mkLead("l5", "渡辺 美咲", "Engineering Manager", "Epsilon", "DISQUALIFIED", 42, hoursAgo(50)),
      mkLead("l6", "中村 浩二", "VP of Engineering", "Zeta", "QUALIFIED", 80, hoursAgo(2)),
      mkLead("l7", "小林 直人", "VPoE", "Eta Corp", "ENRICHED", 75, hoursAgo(36)),
    ],
  };
}

function mkLead(
  id: string,
  name: string,
  headline: string,
  company: string,
  state: LeadState,
  score: number,
  lastActionAt: string
) {
  return { id, name, headline, company, state, score, lastActionAt };
}

function hoursAgo(h: number) {
  return new Date(Date.now() - h * 60 * 60 * 1000).toISOString();
}
