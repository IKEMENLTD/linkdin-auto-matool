import "server-only";
import { eq } from "drizzle-orm";
import { getDb, schema } from "@/db/client";
import { getCurrentUser } from "@/lib/supabase/server";

export type Session = {
  userId: string;
  authUserId: string;
  email: string;
  orgId: string;
  role: (typeof schema.users.$inferSelect)["role"];
  name: string;
};

/**
 * 現在のセッションを返す。
 * - Supabase Auth の `auth.users.id` (UUID) で `public.users.auth_user_id` を引く。
 *   email ベースの突合は禁止 (なりすまし / クロステナントリスク, §17 ABAC)。
 * - 未ログイン or DB 未設定なら null。
 */
export async function getSession(): Promise<Session | null> {
  const user = await getCurrentUser();
  if (!user) return null;
  const db = getDb();
  if (!db) return null;

  const [row] = await db
    .select({
      id: schema.users.id,
      authUserId: schema.users.authUserId,
      email: schema.users.email,
      orgId: schema.users.orgId,
      role: schema.users.role,
      name: schema.users.name,
      isActive: schema.users.isActive,
    })
    .from(schema.users)
    .where(eq(schema.users.authUserId, user.id))
    .limit(1);

  if (!row || !row.isActive) return null;

  return {
    userId: row.id,
    authUserId: row.authUserId,
    email: row.email,
    orgId: row.orgId,
    role: row.role,
    name: row.name,
  };
}

export async function requireSession(): Promise<Session> {
  const s = await getSession();
  if (!s) throw new Error("AUTH_REQUIRED");
  return s;
}

export type Role = Session["role"];

const ROLE_RANK: Record<Role, number> = {
  viewer: 1,
  operator: 2,
  manager: 3,
  admin: 4,
  owner: 5,
};

export function hasAtLeastRole(role: Role, minimum: Role): boolean {
  return ROLE_RANK[role] >= ROLE_RANK[minimum];
}
