import "server-only";
import { eq } from "drizzle-orm";
import { getDb, schema } from "@/db/client";

export type AccountListItem = {
  id: string;
  name: string;
  warmupDay: number;
  status: "active" | "warming" | "safe_mode";
};

export async function listLinkedinAccounts(orgId: string | null): Promise<AccountListItem[]> {
  const db = getDb();
  if (!db || !orgId) {
    // demo accounts (UUID v4 形式で Zod を通せるように)
    return [
      { id: "00000000-0000-4000-8000-000000000001", name: "林 翔太", warmupDay: 14, status: "active" },
      { id: "00000000-0000-4000-8000-000000000002", name: "佐藤 美咲", warmupDay: 7, status: "warming" },
      { id: "00000000-0000-4000-8000-000000000003", name: "鈴木 大輔", warmupDay: 14, status: "safe_mode" },
    ];
  }
  try {
    const rows = await db
      .select({
        id: schema.linkedinAccounts.id,
        name: schema.linkedinAccounts.displayName,
        warmupDay: schema.linkedinAccounts.warmupDay,
        status: schema.linkedinAccounts.status,
      })
      .from(schema.linkedinAccounts)
      .where(eq(schema.linkedinAccounts.orgId, orgId));
    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      warmupDay: r.warmupDay,
      status: (r.status === "safe_mode"
        ? "safe_mode"
        : r.warmupDay < 14
        ? "warming"
        : "active") as AccountListItem["status"],
    }));
  } catch {
    return [];
  }
}
