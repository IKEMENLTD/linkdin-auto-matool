import "server-only";
import { addDays, formatISO, startOfDay, subDays } from "date-fns";
import { and, count, desc, eq, gte, lt, sql } from "drizzle-orm";
import { getDb, schema } from "@/db/client";
import { FUNNEL_ORDER, STATE_SHORT_LABEL, type LeadState } from "@/lib/state-machine";

export type DashboardSnapshot = {
  range: { from: string; to: string; days: number };
  /** NSM: アカウント当たりの週次新規返信。直近 7 日 / 直前 7 日 / アクティブアカウント数 / 目標 */
  nsm: {
    weeklyReplies: number;
    prevWeeklyReplies: number;
    activeAccounts: number;
    target: number;
  };
  kpis: {
    sent: { current: number; previous: number; spark: number[] };
    /** 比率系は 0..1 */
    approvalRate: { current: number; previous: number; spark: number[] };
    replyRate: { current: number; previous: number; spark: number[] };
    meetings: { current: number; previous: number; spark: number[] };
  };
  funnel: { state: LeadState; label: string; count: number }[];
  daily: { date: string; sent: number; replied: number; meeting: number }[];
  attention: AttentionItem[];
  recent: CampaignRow[];
  source: "live" | "mock";
};

export type AttentionItem = {
  id: string;
  kind: "review" | "warmup" | "policy" | "job";
  label: string;
  count?: number;
  href: string;
  cta: string;
};

export type CampaignRow = {
  id: string;
  name: string;
  status: "running" | "draft" | "paused" | "completed" | "safe_mode";
  sent: number;
  replied: number;
  cvr: number;
  owner: string;
};

const DEFAULT_RANGE_DAYS = 30;
const NSM_WINDOW_DAYS = 7;

export async function getDashboardSnapshot(
  orgId: string | null,
  rangeDays = DEFAULT_RANGE_DAYS
): Promise<DashboardSnapshot> {
  const db = getDb();
  if (!db || !orgId) {
    return mockSnapshot(rangeDays);
  }

  const to = startOfDay(new Date());
  const from = subDays(to, rangeDays);
  const prevFrom = subDays(from, rangeDays);
  const prevTo = from;

  // NSM 用の窓
  const nsmFrom = subDays(to, NSM_WINDOW_DAYS);
  const nsmPrevFrom = subDays(nsmFrom, NSM_WINDOW_DAYS);
  const nsmPrevTo = nsmFrom;

  const [activityCurr, activityPrev, funnelRows, nsmCurrAgg, nsmPrevAgg, activeAccountsRow, recentRows, reviewCount, warmupCount, policyCount, jobsFailedCount] = await Promise.all([
    db
      .select({
        day: schema.dailyMetrics.day,
        sent: schema.dailyMetrics.sent,
        connected: schema.dailyMetrics.connected,
        replied: schema.dailyMetrics.replied,
        meeting: schema.dailyMetrics.meeting,
        discovered: schema.dailyMetrics.discovered,
      })
      .from(schema.dailyMetrics)
      .where(
        and(
          eq(schema.dailyMetrics.orgId, orgId),
          gte(schema.dailyMetrics.day, from),
          lt(schema.dailyMetrics.day, to)
        )
      ),
    db
      .select({
        sent: sql<number>`coalesce(sum(${schema.dailyMetrics.sent}), 0)::int`,
        connected: sql<number>`coalesce(sum(${schema.dailyMetrics.connected}), 0)::int`,
        replied: sql<number>`coalesce(sum(${schema.dailyMetrics.replied}), 0)::int`,
        meeting: sql<number>`coalesce(sum(${schema.dailyMetrics.meeting}), 0)::int`,
      })
      .from(schema.dailyMetrics)
      .where(
        and(
          eq(schema.dailyMetrics.orgId, orgId),
          gte(schema.dailyMetrics.day, prevFrom),
          lt(schema.dailyMetrics.day, prevTo)
        )
      ),
    db
      .select({ state: schema.leads.state, count: sql<number>`count(*)::int` })
      .from(schema.leads)
      .where(eq(schema.leads.orgId, orgId))
      .groupBy(schema.leads.state),
    db
      .select({ replied: sql<number>`coalesce(sum(${schema.dailyMetrics.replied}), 0)::int` })
      .from(schema.dailyMetrics)
      .where(
        and(
          eq(schema.dailyMetrics.orgId, orgId),
          gte(schema.dailyMetrics.day, nsmFrom),
          lt(schema.dailyMetrics.day, to)
        )
      ),
    db
      .select({ replied: sql<number>`coalesce(sum(${schema.dailyMetrics.replied}), 0)::int` })
      .from(schema.dailyMetrics)
      .where(
        and(
          eq(schema.dailyMetrics.orgId, orgId),
          gte(schema.dailyMetrics.day, nsmPrevFrom),
          lt(schema.dailyMetrics.day, nsmPrevTo)
        )
      ),
    db
      .select({ value: count() })
      .from(schema.linkedinAccounts)
      .where(
        and(
          eq(schema.linkedinAccounts.orgId, orgId),
          eq(schema.linkedinAccounts.status, "active")
        )
      ),
    db
      .select({
        id: schema.campaigns.id,
        name: schema.campaigns.name,
        status: schema.campaigns.status,
        ownerName: schema.users.name,
      })
      .from(schema.campaigns)
      .leftJoin(schema.users, eq(schema.users.id, schema.campaigns.ownerUserId))
      .where(eq(schema.campaigns.orgId, orgId))
      .orderBy(desc(schema.campaigns.createdAt))
      .limit(5),
    db
      .select({ value: count() })
      .from(schema.leads)
      .where(and(eq(schema.leads.orgId, orgId), eq(schema.leads.state, "REPLIED"))),
    db
      .select({ value: count() })
      .from(schema.linkedinAccounts)
      .where(
        and(eq(schema.linkedinAccounts.orgId, orgId), lt(schema.linkedinAccounts.warmupDay, 14))
      ),
    db
      .select({ value: count() })
      .from(schema.linkedinAccounts)
      .where(
        and(eq(schema.linkedinAccounts.orgId, orgId), eq(schema.linkedinAccounts.status, "safe_mode"))
      ),
    db
      .select({ value: count() })
      .from(schema.leads)
      .where(and(eq(schema.leads.orgId, orgId), eq(schema.leads.state, "FAILED"))),
  ]);

  const sumCurr = activityCurr.reduce(
    (acc, r) => ({
      sent: acc.sent + Number(r.sent),
      connected: acc.connected + Number(r.connected),
      replied: acc.replied + Number(r.replied),
      meeting: acc.meeting + Number(r.meeting),
    }),
    { sent: 0, connected: 0, replied: 0, meeting: 0 }
  );
  const prev = activityPrev[0] ?? { sent: 0, connected: 0, replied: 0, meeting: 0 };

  const approvalCurr = sumCurr.sent > 0 ? sumCurr.connected / sumCurr.sent : 0;
  const approvalPrev = Number(prev.sent) > 0 ? Number(prev.connected) / Number(prev.sent) : 0;
  const replyCurr = sumCurr.sent > 0 ? sumCurr.replied / sumCurr.sent : 0;
  const replyPrev = Number(prev.sent) > 0 ? Number(prev.replied) / Number(prev.sent) : 0;

  const dailyMap = new Map<
    string,
    { sent: number; connected: number; replied: number; meeting: number }
  >();
  for (let i = 0; i < rangeDays; i++) {
    const d = addDays(from, i);
    dailyMap.set(formatISO(d, { representation: "date" }), { sent: 0, connected: 0, replied: 0, meeting: 0 });
  }
  for (const r of activityCurr) {
    const dayValue = r.day instanceof Date ? r.day : new Date(r.day as string);
    const key = formatISO(dayValue, { representation: "date" });
    if (dailyMap.has(key)) {
      dailyMap.set(key, {
        sent: Number(r.sent),
        connected: Number(r.connected),
        replied: Number(r.replied),
        meeting: Number(r.meeting),
      });
    }
  }

  const daily = Array.from(dailyMap.entries()).map(([date, v]) => ({
    date,
    sent: v.sent,
    replied: v.replied,
    meeting: v.meeting,
  }));
  const dailyConnected = Array.from(dailyMap.values()).map((v) => v.connected);

  const stateMap = new Map(funnelRows.map((r) => [r.state as LeadState, Number(r.count)]));
  const funnel = FUNNEL_ORDER.map((s) => ({
    state: s,
    label: STATE_SHORT_LABEL[s],
    count: stateMap.get(s) ?? 0,
  }));

  // attention list
  const attention: AttentionItem[] = [];
  if (Number(reviewCount[0]?.value ?? 0) > 0) {
    attention.push({
      id: "review",
      kind: "review",
      label: "要レビュー返信",
      count: Number(reviewCount[0]?.value ?? 0),
      href: "/inbox?filter=review",
      cta: "受信箱で対応する",
    });
  }
  if (Number(warmupCount[0]?.value ?? 0) > 0) {
    attention.push({
      id: "warmup",
      kind: "warmup",
      label: "ウォームアップ中",
      count: Number(warmupCount[0]?.value ?? 0),
      href: "/connections/linkedin",
      cta: "段階アップの条件を確認",
    });
  }
  if (Number(policyCount[0]?.value ?? 0) > 0) {
    attention.push({
      id: "policy",
      kind: "policy",
      label: "安全モード作動中",
      count: Number(policyCount[0]?.value ?? 0),
      href: "/connections/linkedin?tab=safety",
      cta: "推奨アクションを確認",
    });
  }
  if (Number(jobsFailedCount[0]?.value ?? 0) > 0) {
    attention.push({
      id: "jobs",
      kind: "job",
      label: "失敗ジョブ",
      count: Number(jobsFailedCount[0]?.value ?? 0),
      href: "/jobs?status=failed",
      cta: "再試行 / DLQ で確認",
    });
  }

  const STATUS_MAP: Record<string, CampaignRow["status"]> = {
    draft: "draft",
    running: "running",
    paused: "paused",
    completed: "completed",
    safe_mode: "safe_mode",
  };

  const recent: CampaignRow[] = recentRows.map((c) => ({
    id: c.id,
    name: c.name,
    status: STATUS_MAP[c.status] ?? "draft",
    sent: 0,
    replied: 0,
    cvr: 0,
    owner: c.ownerName ?? "—",
  }));

  return {
    range: { from: from.toISOString(), to: to.toISOString(), days: rangeDays },
    nsm: {
      weeklyReplies: Number(nsmCurrAgg[0]?.replied ?? 0),
      prevWeeklyReplies: Number(nsmPrevAgg[0]?.replied ?? 0),
      activeAccounts: Number(activeAccountsRow[0]?.value ?? 0),
      target: 8,
    },
    kpis: {
      sent: {
        current: sumCurr.sent,
        previous: Number(prev.sent),
        spark: daily.slice(-12).map((d) => d.sent),
      },
      approvalRate: {
        current: approvalCurr,
        previous: approvalPrev,
        spark: dailyConnected.slice(-12),
      },
      replyRate: {
        current: replyCurr,
        previous: replyPrev,
        spark: daily.slice(-12).map((d) => d.replied),
      },
      meetings: {
        current: sumCurr.meeting,
        previous: Number(prev.meeting),
        spark: daily.slice(-12).map((d) => d.meeting),
      },
    },
    funnel,
    daily,
    attention,
    recent,
    source: "live",
  };
}

/* ---------------- Mock ----------------- */

function mockSnapshot(rangeDays: number): DashboardSnapshot {
  const today = startOfDay(new Date());
  const start = subDays(today, rangeDays);

  const daily: { date: string; sent: number; replied: number; meeting: number; connected: number }[] = [];
  for (let i = 0; i < rangeDays; i++) {
    const d = addDays(start, i);
    const wd = d.getDay();
    const base = wd === 0 || wd === 6 ? 6 : 32 + Math.round(Math.sin(i / 3) * 8);
    const sent = Math.max(0, base + Math.round((Math.random() - 0.4) * 8));
    const connected = Math.round(sent * (0.36 + Math.random() * 0.08));
    const replied = Math.round(sent * (0.06 + Math.random() * 0.04));
    const meeting = Math.round(replied * (0.18 + Math.random() * 0.08));
    daily.push({
      date: formatISO(d, { representation: "date" }),
      sent,
      replied,
      meeting,
      connected,
    });
  }

  const sumCurr = daily.reduce(
    (a, b) => ({
      sent: a.sent + b.sent,
      connected: a.connected + b.connected,
      replied: a.replied + b.replied,
      meeting: a.meeting + b.meeting,
    }),
    { sent: 0, connected: 0, replied: 0, meeting: 0 }
  );
  const sumPrev = {
    sent: Math.round(sumCurr.sent * 0.86),
    connected: Math.round(sumCurr.connected * 0.84),
    replied: Math.round(sumCurr.replied * 0.74),
    meeting: Math.round(sumCurr.meeting * 0.62),
  };

  const last7 = daily.slice(-7);
  const prev7 = daily.slice(-14, -7);
  const weeklyReplies = last7.reduce((a, b) => a + b.replied, 0);
  const prevWeeklyReplies = prev7.reduce((a, b) => a + b.replied, 0);

  return {
    range: { from: start.toISOString(), to: today.toISOString(), days: rangeDays },
    nsm: {
      weeklyReplies,
      prevWeeklyReplies,
      activeAccounts: 3,
      target: 8,
    },
    kpis: {
      sent: {
        current: sumCurr.sent,
        previous: sumPrev.sent,
        spark: daily.slice(-12).map((d) => d.sent),
      },
      approvalRate: {
        current: sumCurr.sent ? sumCurr.connected / sumCurr.sent : 0,
        previous: sumPrev.sent ? sumPrev.connected / sumPrev.sent : 0,
        spark: daily.slice(-12).map((d) => d.connected),
      },
      replyRate: {
        current: sumCurr.sent ? sumCurr.replied / sumCurr.sent : 0,
        previous: sumPrev.sent ? sumPrev.replied / sumPrev.sent : 0,
        spark: daily.slice(-12).map((d) => d.replied),
      },
      meetings: {
        current: sumCurr.meeting,
        previous: sumPrev.meeting,
        spark: daily.slice(-12).map((d) => d.meeting),
      },
    },
    funnel: [
      { state: "DISCOVERED" as LeadState, label: STATE_SHORT_LABEL.DISCOVERED, count: 12034 },
      { state: "ENRICHED" as LeadState, label: STATE_SHORT_LABEL.ENRICHED, count: 7821 },
      { state: "QUALIFIED" as LeadState, label: STATE_SHORT_LABEL.QUALIFIED, count: 3142 },
      { state: "CONNECTED" as LeadState, label: STATE_SHORT_LABEL.CONNECTED, count: 1284 },
      { state: "REPLIED" as LeadState, label: STATE_SHORT_LABEL.REPLIED, count: 219 },
      { state: "MEETING" as LeadState, label: STATE_SHORT_LABEL.MEETING, count: 47 },
    ],
    daily: daily.map(({ date, sent, replied, meeting }) => ({ date, sent, replied, meeting })),
    attention: [
      { id: "a1", kind: "review", label: "要レビュー返信", count: 12, href: "/inbox?filter=review", cta: "受信箱で対応する" },
      { id: "a2", kind: "warmup", label: "ウォームアップ中", count: 2, href: "/connections/linkedin", cta: "段階アップの条件を確認" },
      { id: "a3", kind: "policy", label: "規約注意", count: 1, href: "/connections/linkedin?tab=safety", cta: "詳細と推奨アクション" },
      { id: "a4", kind: "job", label: "ジョブ失敗", count: 3, href: "/jobs?status=failed", cta: "再試行 / DLQ で確認" },
    ],
    recent: [
      { id: "c1", name: "Series B SaaS · VPoE 開拓", status: "running", sent: 412, replied: 32, cvr: 0.078, owner: "林 翔太" },
      { id: "c2", name: "FinOps 製造業 — 経営層", status: "running", sent: 298, replied: 18, cvr: 0.060, owner: "佐藤 美咲" },
      { id: "c3", name: "AI 採用スカウト Q2", status: "paused", sent: 156, replied: 9, cvr: 0.058, owner: "鈴木 大輔" },
      { id: "c4", name: "イベント招待 — TechBridge", status: "draft", sent: 0, replied: 0, cvr: 0, owner: "山本 拓也" },
      { id: "c5", name: "EU SaaS 共創パートナー", status: "completed", sent: 220, replied: 28, cvr: 0.127, owner: "田中 健司" },
    ],
    source: "mock",
  };
}
