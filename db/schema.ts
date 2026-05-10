import {
  pgTable,
  uuid,
  varchar,
  text,
  timestamp,
  date,
  integer,
  jsonb,
  pgEnum,
  index,
  uniqueIndex,
  boolean,
  primaryKey,
} from "drizzle-orm/pg-core";

/**
 * 状態機械（UI/UX 設計書 §3.3 / §21.2）。
 * UI 文字列・色は lib/state-machine.ts 側で管理する。
 */
export const leadStateEnum = pgEnum("lead_state", [
  "DISCOVERED",
  "ENRICHED",
  "QUALIFIED",
  "DISQUALIFIED",
  "PENDING",
  "CONNECTED",
  "MESSAGED",
  "REPLIED",
  "MEETING",
  "COMPLETED",
  "FAILED",
  "EXPIRED",
  "SAFE_MODE",
  "QUARANTINED",
]);

export const planEnum = pgEnum("plan", ["solo", "team", "scale", "enterprise"]);

export const roleEnum = pgEnum("role", [
  "owner",
  "admin",
  "manager",
  "operator",
  "viewer",
]);

export const campaignStatusEnum = pgEnum("campaign_status", [
  "draft",
  "running",
  "paused",
  "completed",
  "safe_mode",
]);

export const hitlStateEnum = pgEnum("hitl_state", [
  "REVIEW_REQUIRED",
  "SEMI_AUTO",
  "FULL_AUTO",
]);

export const messageDirectionEnum = pgEnum("message_direction", ["outbound", "inbound"]);

/* === Tenancy ============================================================ */

export const organizations = pgTable("organizations", {
  id: uuid("id").defaultRandom().primaryKey(),
  name: varchar("name", { length: 120 }).notNull(),
  plan: planEnum("plan").notNull().default("team"),
  region: varchar("region", { length: 8 }).notNull().default("jp"),
  stripeCustomerId: varchar("stripe_customer_id", { length: 64 }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const users = pgTable(
  "users",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    /** Supabase Auth (auth.users.id) との一意紐付け。email 一致ベースは禁止 (§17 ABAC) */
    authUserId: uuid("auth_user_id").notNull(),
    email: varchar("email", { length: 254 }).notNull(),
    name: varchar("name", { length: 120 }).notNull(),
    role: roleEnum("role").notNull().default("operator"),
    avatarUrl: text("avatar_url"),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    authUserIdx: uniqueIndex("users_auth_user_idx").on(t.authUserId),
    emailOrgIdx: uniqueIndex("users_email_org_idx").on(t.orgId, t.email),
    orgIdx: index("users_org_idx").on(t.orgId),
  })
);

/* === LinkedIn / Unipile ================================================ */

export const linkedinAccounts = pgTable(
  "linkedin_accounts",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    ownerUserId: uuid("owner_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    displayName: varchar("display_name", { length: 120 }).notNull(),
    unipileAccountId: varchar("unipile_account_id", { length: 64 }).notNull(),
    status: varchar("status", { length: 24 }).notNull().default("active"),
    /** ウォームアップ日数 0..14 */
    warmupDay: integer("warmup_day").notNull().default(0),
    dailyLimit: integer("daily_limit").notNull().default(25),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    orgIdx: index("la_org_idx").on(t.orgId),
    ownerIdx: index("la_owner_idx").on(t.ownerUserId),
    unipileIdx: uniqueIndex("la_unipile_idx").on(t.unipileAccountId),
  })
);

/* === Campaigns ========================================================= */

export const campaigns = pgTable(
  "campaigns",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    name: varchar("name", { length: 160 }).notNull(),
    status: campaignStatusEnum("status").notNull().default("draft"),
    hitlState: hitlStateEnum("hitl_state").notNull().default("REVIEW_REQUIRED"),
    icpDescription: text("icp_description"),
    productDocs: jsonb("product_docs").$type<Record<string, unknown>>(),
    ownerUserId: uuid("owner_user_id").references(() => users.id, { onDelete: "set null" }),
    startsAt: timestamp("starts_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({ orgIdx: index("camp_org_idx").on(t.orgId) })
);

/* === Leads ============================================================= */

export const leads = pgTable(
  "leads",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    campaignId: uuid("campaign_id")
      .notNull()
      .references(() => campaigns.id, { onDelete: "cascade" }),
    linkedinUrl: varchar("linkedin_url", { length: 256 }).notNull(),
    fullName: varchar("full_name", { length: 160 }),
    headline: varchar("headline", { length: 256 }),
    company: varchar("company", { length: 160 }),
    state: leadStateEnum("state").notNull().default("DISCOVERED"),
    score: integer("score").notNull().default(0),
    assignedAccountId: uuid("assigned_account_id").references(() => linkedinAccounts.id, {
      onDelete: "set null",
    }),
    metadata: jsonb("metadata").$type<Record<string, unknown>>(),
    lastActionAt: timestamp("last_action_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    orgIdx: index("leads_org_idx").on(t.orgId),
    campIdx: index("leads_camp_idx").on(t.campaignId),
    stateIdx: index("leads_state_idx").on(t.state),
  })
);

/* === Messages / Inbox ================================================== */

export const messages = pgTable(
  "messages",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    leadId: uuid("lead_id")
      .notNull()
      .references(() => leads.id, { onDelete: "cascade" }),
    direction: messageDirectionEnum("direction").notNull(),
    content: text("content").notNull(),
    aiAssisted: boolean("ai_assisted").notNull().default(false),
    sentAt: timestamp("sent_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    leadIdx: index("msg_lead_idx").on(t.leadId),
    sentIdx: index("msg_sent_idx").on(t.sentAt),
  })
);

/* === Daily metrics aggregation (precomputed) =========================== */

export const dailyMetrics = pgTable(
  "daily_metrics",
  {
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    /** JST 基準で 1 日を YYYY-MM-DD で表現する。集計バッチが JST で確定。 */
    day: date("day", { mode: "date" }).notNull(),
    sent: integer("sent").notNull().default(0),
    connected: integer("connected").notNull().default(0),
    replied: integer("replied").notNull().default(0),
    meeting: integer("meeting").notNull().default(0),
    discovered: integer("discovered").notNull().default(0),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.orgId, t.day] }),
    dayIdx: index("dm_day_idx").on(t.day),
  })
);

/* === Audit log (append-only / hash chain) ============================== */

export const auditLog = pgTable(
  "audit_log",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    actorUserId: uuid("actor_user_id"),
    action: varchar("action", { length: 64 }).notNull(),
    targetType: varchar("target_type", { length: 32 }),
    targetId: varchar("target_id", { length: 64 }),
    purpose: text("purpose"),
    diff: jsonb("diff").$type<Record<string, unknown>>(),
    fromIp: varchar("from_ip", { length: 64 }),
    fromUa: varchar("from_ua", { length: 256 }),
    correlationId: varchar("correlation_id", { length: 64 }),
    /** 直前エントリの hash（hash chain）*/
    prevHash: varchar("prev_hash", { length: 128 }),
    /** SHA-256 of (prevHash || normalized(this entry)) */
    hash: varchar("hash", { length: 128 }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    orgIdx: index("audit_org_idx").on(t.orgId),
    actionIdx: index("audit_action_idx").on(t.action),
    createdIdx: index("audit_created_idx").on(t.createdAt),
  })
);

export type Organization = typeof organizations.$inferSelect;
export type User = typeof users.$inferSelect;
export type LinkedinAccount = typeof linkedinAccounts.$inferSelect;
export type Campaign = typeof campaigns.$inferSelect;
export type Lead = typeof leads.$inferSelect;
export type Message = typeof messages.$inferSelect;
export type DailyMetric = typeof dailyMetrics.$inferSelect;
export type AuditLogEntry = typeof auditLog.$inferSelect;
