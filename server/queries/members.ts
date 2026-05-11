import "server-only";
import { eq, desc } from "drizzle-orm";
import { getDb, schema } from "@/db/client";
import { newIncidentId } from "@/lib/incident";
import type { Role } from "@/lib/auth";

export type Member = {
  id: string;
  email: string;
  name: string;
  role: Role;
  avatarUrl: string | null;
  isActive: boolean;
  lastLoginAt: string | null;
  createdAt: string;
};

export type MembersResult =
  | { ok: true; members: Member[]; source: "live" | "mock" }
  | { ok: false; reason: "degraded"; incidentId: string };

export async function listMembers(orgId: string | null): Promise<MembersResult> {
  const db = getDb();
  if (!db || !orgId) return { ok: true, source: "mock", members: mockMembers() };

  try {
    const rows = await db
      .select({
        id: schema.users.id,
        email: schema.users.email,
        name: schema.users.name,
        role: schema.users.role,
        avatarUrl: schema.users.avatarUrl,
        isActive: schema.users.isActive,
        createdAt: schema.users.createdAt,
      })
      .from(schema.users)
      .where(eq(schema.users.orgId, orgId))
      .orderBy(desc(schema.users.createdAt));
    return {
      ok: true,
      source: "live",
      members: rows.map((r) => ({
        id: r.id,
        email: r.email,
        name: r.name,
        role: r.role,
        avatarUrl: r.avatarUrl,
        isActive: r.isActive,
        lastLoginAt: null,
        createdAt: r.createdAt.toISOString(),
      })),
    };
  } catch (e) {
    const incidentId = newIncidentId();
    if (process.env.NODE_ENV !== "production") console.error(`[listMembers] ${incidentId}`, e);
    return { ok: false, reason: "degraded", incidentId };
  }
}

function mockMembers(): Member[] {
  const base = Date.now();
  return [
    mk("u1", "tanaka@ikemen.example", "田中 健司", "owner", true, base - 86_400_000 * 200),
    mk("u2", "hayashi@ikemen.example", "林 翔太", "manager", true, base - 86_400_000 * 120),
    mk("u3", "sato@ikemen.example", "佐藤 美咲", "operator", true, base - 86_400_000 * 90),
    mk("u4", "suzuki@ikemen.example", "鈴木 大輔", "operator", true, base - 86_400_000 * 60),
    mk("u5", "yamamoto@ikemen.example", "山本 拓也", "viewer", true, base - 86_400_000 * 30),
    mk("u6", "ex-employee@ikemen.example", "(退職済)", "operator", false, base - 86_400_000 * 14),
  ];
}

function mk(id: string, email: string, name: string, role: Role, isActive: boolean, createdAtMs: number): Member {
  return {
    id,
    email,
    name,
    role,
    avatarUrl: null,
    isActive,
    lastLoginAt: null,
    createdAt: new Date(createdAtMs).toISOString(),
  };
}

export const ROLE_LABEL: Record<Role, string> = {
  owner: "Owner",
  admin: "Admin",
  manager: "Manager",
  operator: "Operator",
  viewer: "Viewer",
};

export const ROLE_DESC: Record<Role, string> = {
  owner: "プラン変更 / メンバー全権 / 監査ログ削除（保持期間後のみ）",
  admin: "メンバー招待 / 監査ログ参照 / 接続管理",
  manager: "キャンペーン作成 / メッセージ送信 / 一括操作",
  operator: "メッセージ送信 / 担当受信箱の対応",
  viewer: "集計情報のみ閲覧",
};
